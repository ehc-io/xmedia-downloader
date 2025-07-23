#!/usr/bin/env node
/**
 * This script refreshes the Twitter/X session.
 * It is called by twitter-media-extractor.py when session data is missing or invalid.
 * 
 * Usage:
 * - Make sure X_USERNAME and X_PASSWORD environment variables are set
 * - Run: node refresh_twitter_session.js
 */

const { chromium } = require('playwright');
const { Storage } = require('@google-cloud/storage');

// GCS Client
const storage = new Storage();
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;

// Configuration variables - SIMPLIFIED
const NETWORK_TIMEOUT = process.env.NETWORK_TIMEOUT ? parseInt(process.env.NETWORK_TIMEOUT, 10) : 30000;
const INTERACTION_TIMEOUT = process.env.INTERACTION_TIMEOUT ? parseInt(process.env.INTERACTION_TIMEOUT, 10) : 5000;
// const TWEET_WAIT_TIMEOUT = 2000;

// Control whether to take login screenshots
const LOGIN_SCREENSHOTS = true;

/**
 * Logger utility to provide consistent timestamp format
 */
class Logger {
  static log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
  }
  
  static error(message, err) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR: ${message}`, err || '');
  }
}

/**
 * Formats timestamp for filenames by replacing characters not allowed in filenames
 * @returns {string} Formatted timestamp for filenames
 */
function getFormattedTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Takes a screenshot and uploads it to GCS
 * @param {Page} page - Playwright page object
 * @param {string} filename - Base filename for the screenshot
 * @returns {Promise<void>}
 */
async function takeScreenshot(page, filename) {
  if (!LOGIN_SCREENSHOTS) return;

  if (!GCS_BUCKET_NAME) {
    Logger.error('GCS_BUCKET_NAME environment variable not set. Cannot upload screenshot.');
    return;
  }
  
  try {
    Logger.log(`Attempting to take screenshot: ${filename}`);
    
    // Use a shorter timeout for screenshots to avoid hanging
    const screenshotBuffer = await page.screenshot({ 
      fullPage: true, 
      timeout: 10000  // 10 second timeout instead of default 30 seconds
    });
    
    const destination = `screenshots/${getFormattedTimestamp()}-${filename}.png`;
    
    await storage.bucket(GCS_BUCKET_NAME).file(destination).save(screenshotBuffer);
    Logger.log(`Screenshot uploaded to gs://${GCS_BUCKET_NAME}/${destination}`);
  } catch (error) {
    if (error.name === 'TimeoutError') {
      Logger.error(`Screenshot creation timed out for ${filename}:`, error);
    } else if (error.message && error.message.includes('save')) {
      Logger.error(`Failed to upload screenshot ${filename} to GCS:`, error);
    } else {
      Logger.error(`Failed to create screenshot ${filename}:`, error);
    }
    // Don't throw - continue with login process even if screenshot fails
  }
}

/**
 * Saves session data to Google Cloud Storage and local file
 * @param {BrowserContext} context - Playwright browser context
 * @returns {Promise<void>}
 */
async function saveSessionToGCS(context) {
  if (!GCS_BUCKET_NAME) {
    Logger.error('GCS_BUCKET_NAME environment variable not set. Cannot save session to GCS.');
    return;
  }
  
  try {
    Logger.log('Saving session data to GCS and local file...');
    const storageState = await context.storageState();
    const sessionData = JSON.stringify(storageState, null, 2);
    
    // Save to GCS
    const destination = 'session-data/x-session.json';
    await storage.bucket(GCS_BUCKET_NAME).file(destination).save(sessionData);
    Logger.log(`Session data saved to gs://${GCS_BUCKET_NAME}/${destination}`);
    
    // Also save to local file for Python script to use
    const fs = require('fs').promises;
    const path = require('path');
    const localSessionDir = '/tmp/session-data';
    const localSessionFile = path.join(localSessionDir, 'x-session.json');
    
    // Ensure directory exists
    await fs.mkdir(localSessionDir, { recursive: true });
    await fs.writeFile(localSessionFile, sessionData);
    Logger.log(`Session data also saved locally to ${localSessionFile}`);
    
  } catch (error) {
    Logger.error('Failed to save session to GCS or local file:', error);
  }
}

/**
 * Loads session data from Google Cloud Storage
 * @returns {Promise<object|null>} - Parsed session data or null if not found/error
 */
async function loadSessionFromGCS() {
  if (!GCS_BUCKET_NAME) {
    Logger.error('GCS_BUCKET_NAME environment variable not set. Cannot load session from GCS.');
    return null;
  }
  
  Logger.log(`[GCS READ] Attempting to load session data from GCS bucket: ${GCS_BUCKET_NAME}`);
  Logger.log(`[GCS READ] Target blob path: session-data/x-session.json`);
  
  try {
    const file = storage.bucket(GCS_BUCKET_NAME).file('session-data/x-session.json');
    
    Logger.log('[GCS READ] Checking if session file exists in GCS...');
    const [exists] = await file.exists();
    Logger.log(`[GCS READ] Session file existence check result: ${exists}`);
    
    if (exists) {
      Logger.log('[GCS READ] Session file found in GCS, attempting to download...');
      try {
        const [sessionDataBuffer] = await file.download();
        const sessionDataSize = sessionDataBuffer.length;
        Logger.log(`[GCS READ] Successfully downloaded session data from GCS (${sessionDataSize} bytes)`);
        
        const sessionData = JSON.parse(sessionDataBuffer.toString('utf8'));
        const cookieCount = sessionData.cookies ? sessionData.cookies.length : 0;
        const originCount = sessionData.origins ? sessionData.origins.length : 0;
        Logger.log(`[GCS READ] Successfully parsed session data - Cookies: ${cookieCount}, Origins: ${originCount}`);
        
        return sessionData;
      } catch (parseError) {
        Logger.error('[GCS READ] Failed to parse downloaded session data as JSON:', parseError);
        return null;
      }
    } else {
      Logger.log('[GCS READ] No session file found in GCS bucket');
      return null;
    }
  } catch (error) {
    Logger.error('[GCS READ] Failed to access GCS bucket or download session data:', error);
    Logger.error(`[GCS READ] Error details - Bucket: ${GCS_BUCKET_NAME}, Blob: session-data/x-session.json`);
    return null;
  }
}


/**
 * Checks if the session is valid
 * @param {BrowserContext} context - Playwright browser context
 * @returns {Promise<boolean>} - Whether the session is valid
 */
async function isSessionValid(context) {
  Logger.log('Verifying if session is valid...');
  Logger.log(`Using network timeout: ${NETWORK_TIMEOUT}ms for session validation`);
  const page = await context.newPage();
  try {
    await page.goto("https://x.com/home", { timeout: NETWORK_TIMEOUT });
    Logger.log('Successfully loaded home page for session validation');
    await page.waitForTimeout(INTERACTION_TIMEOUT);
    
    // Use the same validation logic as Python script - check for compose button
    const composeButton = await page.querySelector('a[data-testid="SideNav_NewTweet_Button"]');
    const isLoginSuccessful = composeButton !== null;
    
    if (isLoginSuccessful) {
      Logger.log('Session validation: Found compose button, session appears valid.');
    } else {
      Logger.log(`Session validation: Compose button not found, session appears invalid. Title: ${await page.title()}`);
    }

    await page.close();
    return isLoginSuccessful;
  } catch (error) {
    Logger.error('Error while checking session validity:', error);
    // Take screenshot on timeout/error for debugging
    try {
      await takeScreenshot(page, 'session-validation-timeout');
      Logger.log('Screenshot taken due to session validation timeout/error.');
    } catch (screenshotError) {
      Logger.error('Failed to take timeout screenshot:', screenshotError);
    }
    await page.close();
    return false;
  }
}

/**
 * Performs login to X.com
 * @param {BrowserContext} context - Playwright browser context
 * @returns {Promise<boolean>} - Whether login was successful
 */
async function performLogin(context) {
  Logger.log('Performing login...');
  
  // Get credentials from environment variables
  const username = process.env.X_USERNAME;
  const password = process.env.X_PASSWORD;
  const email = process.env.X_EMAIL;
  
  if (!username || !password) {
    throw new Error('X_USERNAME and X_PASSWORD environment variables must be set');
  }
  
  if (!email) {
    Logger.log('X_EMAIL environment variable not set. Email confirmation step will be skipped if encountered.');
  }
  
  const page = await context.newPage();

  try {
    Logger.log('Navigating to Twitter/X login page...');
    Logger.log(`Using network timeout: ${NETWORK_TIMEOUT}ms`);
    await page.goto('https://x.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: NETWORK_TIMEOUT
    });
    Logger.log('Successfully loaded Twitter/X login page');

    await takeScreenshot(page, 'login-page');

    // Wait for username input to be visible
    const usernameSelector = 'input[name="text"]';
    Logger.log('Waiting for username input field...');
    try {
      await page.waitForSelector(usernameSelector, { state: 'visible', timeout: INTERACTION_TIMEOUT });
    } catch (error) {
      Logger.error('Timeout waiting for username input field:', error);
      await takeScreenshot(page, 'username-input-timeout');
      throw error;
    }
    
    // Fill username
    await page.fill(usernameSelector, username);
    await page.waitForTimeout(INTERACTION_TIMEOUT);
    Logger.log('Filled username field.');

    // Take screenshot BEFORE trying to click "Next"
    await takeScreenshot(page, 'before-next-click');
    Logger.log('Took screenshot before attempting to click "Next" button.');

    // Use a more robust selector to find and click the "Next" button
    const nextButtonLocator = page.locator('button:has-text("Next")').first();
    Logger.log('Waiting for "Next" button to be visible...');
    try {
      await nextButtonLocator.waitFor({ state: 'visible', timeout: INTERACTION_TIMEOUT });
    } catch (error) {
      Logger.error('Timeout waiting for Next button:', error);
      await takeScreenshot(page, 'next-button-timeout');
      throw error;
    }
    
    Logger.log('Clicking "Next" button...');
    await nextButtonLocator.click();
    Logger.log('Clicked "Next" after entering username.');

    // Screenshot after clicking 'Next' to see the result
    await takeScreenshot(page, 'after-username-next-click');
    Logger.log('Took screenshot after clicking Next.');
    
    // Wait for a bit for the next page to load
    await page.waitForTimeout(INTERACTION_TIMEOUT);

    // Check if email confirmation field appears (sometimes Twitter asks for email verification)
    const emailConfirmationSelector = 'input[data-testid="ocfEnterTextTextInput"]';
    const isEmailConfirmationVisible = await page.isVisible(emailConfirmationSelector);
    
    if (isEmailConfirmationVisible) {
      Logger.log('Email confirmation field detected, attempting to fill it...');
      
      if (!email) {
        Logger.error('Email confirmation field appeared but X_EMAIL environment variable is not set');
        await takeScreenshot(page, 'email-confirmation-no-email');
        throw new Error('Email confirmation required but X_EMAIL environment variable not set');
      }
      
      // Fill email confirmation field
      await page.fill(emailConfirmationSelector, email);
      await page.waitForTimeout(INTERACTION_TIMEOUT);
      Logger.log('Filled email confirmation field.');
      
      // Take screenshot before clicking email Next button
      await takeScreenshot(page, 'before-email-next-click');
      
      // Click email Next button
      const emailNextButtonSelector = 'button[data-testid="ocfEnterTextNextButton"]';
      Logger.log('Waiting for email Next button...');
      try {
        await page.waitForSelector(emailNextButtonSelector, { state: 'visible', timeout: INTERACTION_TIMEOUT });
      } catch (error) {
        Logger.error('Timeout waiting for email Next button:', error);
        await takeScreenshot(page, 'email-next-button-timeout');
        throw error;
      }
      
      Logger.log('Clicking email "Next" button...');
      await page.click(emailNextButtonSelector);
      Logger.log('Clicked email "Next" button.');
      
      // Screenshot after clicking email Next
      await takeScreenshot(page, 'after-email-next-click');
      
      // Wait for the next page to load
      await page.waitForTimeout(INTERACTION_TIMEOUT);
    } else {
      Logger.log('No email confirmation field detected, proceeding to password field...');
    }

    // Wait for password field and fill it
    const passwordSelector = 'input[name="password"]';
    Logger.log('Waiting for password input field...');
    try {
      await page.waitForSelector(passwordSelector, { state: 'visible', timeout: INTERACTION_TIMEOUT });
    } catch (error) {
      Logger.error('Timeout waiting for password input field:', error);
      await takeScreenshot(page, 'password-input-timeout');
      throw error;
    }
    await page.fill(passwordSelector, password);
    await page.waitForTimeout(INTERACTION_TIMEOUT);

    // Wait for login button to be visible
    const loginButtonSelector = 'button[data-testid="LoginForm_Login_Button"]';
    Logger.log('Waiting for login button...');
    try {
      await page.waitForSelector(loginButtonSelector, { state: 'visible', timeout: INTERACTION_TIMEOUT });
    } catch (error) {
      Logger.error('Timeout waiting for login button:', error);
      await takeScreenshot(page, 'login-button-timeout');
      throw error;
    }
    
    // Take screenshot before clicking login button
    await takeScreenshot(page, 'before-login-click');
    
    // Click Login button
    await page.click(loginButtonSelector);
    
    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: NETWORK_TIMEOUT }).catch(() => {
      Logger.log('Navigation timeout occurred, but continuing...');
    });
    
    // Additional wait to ensure page is fully loaded
    await page.waitForTimeout(INTERACTION_TIMEOUT);
    
    // Take screenshot after login
    await takeScreenshot(page, 'after-login');

    // Verify login success by checking for a unique element on the home page
    try {
      await page.waitForURL('**/home', { timeout: NETWORK_TIMEOUT });
    } catch (error) {
      Logger.error('Timeout waiting for home page URL:', error);
      await takeScreenshot(page, 'home-url-timeout');
      throw error;
    }
    const isLoginSuccessful = page.url().includes('/home');

    if (!isLoginSuccessful) {
      // Take screenshot of failed login state
      await takeScreenshot(page, 'login-failed');
      throw new Error('Login failed: Could not verify Home page after login attempt');
    }
    
    Logger.log('Login successful');
    
    // Save session data to GCS
    await saveSessionToGCS(context);
    
    await page.close();
    return true;
  } catch (error) {
    Logger.error('Error during login:', error);
    // Take screenshot on any login error for debugging
    try {
      await takeScreenshot(page, 'login-error');
      Logger.log('Screenshot taken due to login error.');
    } catch (screenshotError) {
      Logger.error('Failed to take error screenshot:', screenshotError);
    }
    await page.close();
    return false;
  }
}

/**
 * Gets a browser context with valid authentication
 * @param {Browser} browser - Playwright browser instance
 * @returns {Promise<BrowserContext>} - Authenticated browser context
 */
async function getAuthenticatedContext(browser) {
  let context;
  let hasValidSession = false;
  
  // Check if we have session data in GCS
  const sessionData = await loadSessionFromGCS();
  if (sessionData) {
    try {
      context = await browser.newContext({
        storageState: sessionData
      });
      
      // Verify if session is still valid
      hasValidSession = await isSessionValid(context);
      
      if (!hasValidSession) {
        Logger.log('Session is no longer valid, will attempt fresh login');
        await context.close();
        context = null;
      }
    } catch (error) {
      Logger.error('Error while restoring session from GCS data:', error);
      Logger.log('Will attempt fresh login');
      if (context) await context.close();
      context = null;
    }
  } else {
    Logger.log('No session data found in GCS, will perform login');
  }
  
  // If session is not valid, perform login
  if (!hasValidSession) {
    Logger.log('Creating new browser context for login...');
    context = await browser.newContext();
    
    hasValidSession = await performLogin(context);
    
    if (!hasValidSession) {
      throw new Error('Failed to establish a valid session');
    }
  }
  
  return context;
}

// Main function - Entry point of the script
async function main() {
    console.log('Starting Twitter/X session refresh...');
    const PROXY = process.env.PROXY;

    let browserOptions = { headless: true };
    if (PROXY) {
        Logger.log(`Using proxy: ${PROXY}`);
        const proxyConfig = {};
        if (PROXY.includes('@')) {
            const [auth, server] = PROXY.split('@');
            const [username, password] = auth.split(':');
            proxyConfig.server = `http://${server}`;
            proxyConfig.username = username;
            proxyConfig.password = password;
            Logger.log(`Proxy configured with authentication for server: http://${server}`);
        } else {
            proxyConfig.server = `http://${PROXY}`;
            Logger.log(`Proxy configured without authentication for server: http://${PROXY}`);
        }
        browserOptions.proxy = proxyConfig;
        
        // Validate proxy format
        try {
            new URL(proxyConfig.server);
        } catch (e) {
            Logger.error(`Invalid proxy URL format: ${proxyConfig.server}`);
        }
    } else {
        Logger.log('No proxy configured, using direct connection');
    }
    
    Logger.log(`Timeout configurations - Network: ${NETWORK_TIMEOUT}ms, Interaction: ${INTERACTION_TIMEOUT}ms`);
    
    let browser;
    try {
        browser = await chromium.launch(browserOptions);
        Logger.log('Browser launched successfully');
    } catch (error) {
        Logger.error('Failed to launch browser:', error);
        if (PROXY) {
            Logger.error('Browser launch failed with proxy configuration. Check proxy settings.');
        }
        throw error;
    }
    
    try {
        await getAuthenticatedContext(browser);
        console.log('Session refreshed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Failed to refresh session:', error);
        process.exit(1);
    } finally {
        Logger.log('Closing browser...');
        await browser.close();
    }
}

// Execute main function
main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
}); 