#!/usr/bin/env node
/**
 * This script refreshes the Twitter/X session.
 * It is called by twitter-media-extractor.py when session data is missing or invalid.
 * 
 * Usage:
 * - Make sure X_USERNAME and X_PASSWORD environment variables are set
 * - Run: node refresh_twitter_session.js
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Configuration variables
const PAGE_LOAD_TIMEOUT = process.env.PAGE_LOAD_TIMEOUT ? parseInt(process.env.PAGE_LOAD_TIMEOUT, 10) : 3000;
const LOGIN_WAIT_TIMEOUT = process.env.LOGIN_WAIT_TIMEOUT ? parseInt(process.env.LOGIN_WAIT_TIMEOUT, 10) : 15000;
const FORM_INTERACTION_DELAY = process.env.FORM_INTERACTION_DELAY ? parseInt(process.env.FORM_INTERACTION_DELAY, 10) : 3000;
const SELECTOR_TIMEOUT = process.env.SELECTOR_TIMEOUT ? parseInt(process.env.SELECTOR_TIMEOUT, 10) : 3000;
// const TWEET_WAIT_TIMEOUT = 2000;

// Control whether to take login screenshots
const LOGIN_SCREENSHOTS = true;

// Session configuration
const SESSION_DATA_DIR = "session-data";
const SESSION_DATA_PATH = path.join(SESSION_DATA_DIR, "session.json");

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
 * Takes a screenshot
 * @param {Page} page - Playwright page object
 * @param {string} filename - Base filename for the screenshot
 * @returns {Promise<void>}
 */
async function takeScreenshot(page, filename) {
  if (!LOGIN_SCREENSHOTS) return;
  
  const screenshotsDir = 'screenshots';
  ensureDirectoryExists(screenshotsDir); // This ensures the directory exists
  
  const screenshotPath = `${screenshotsDir}/${getFormattedTimestamp()}-${filename}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  Logger.log(`Screenshot captured: ${screenshotPath}`);
}

/**
 * Ensures a directory exists, creating it if necessary
 * @param {string} directory - Directory path to check/create
 */
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    Logger.log(`Created directory: ${directory}`);
  }
}

/**
 * Checks if the session is valid
 * @param {BrowserContext} context - Playwright browser context
 * @returns {Promise<boolean>} - Whether the session is valid
 */
async function isSessionValid(context) {
  Logger.log('Verifying if session is valid...');
  const page = await context.newPage();
  try {
    await page.goto("https://x.com/home");
    await page.waitForTimeout(PAGE_LOAD_TIMEOUT);
    
    // Verify login success
    const isLoginSuccessful = await page.evaluate(() => {
      return document.title.includes("Home");
    });

    await page.close();
    return isLoginSuccessful;
  } catch (error) {
    Logger.error('Error while checking session validity:', error);
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
  
  if (!username || !password) {
    throw new Error('X_USERNAME and X_PASSWORD environment variables must be set');
  }
  
  const page = await context.newPage();
  const screenshotsDir = path.join(__dirname, 'screenshots');

  try {
    Logger.log('Navigating to Twitter/X login page...');
    await page.goto('https://x.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_LOAD_TIMEOUT
    });

    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshotPath = path.join(screenshotsDir, `login-page-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath });
    Logger.log(`Screenshot of login page saved to ${screenshotPath}`);

    // Wait for username input to be visible
    const usernameSelector = 'input[name="text"]';
    Logger.log('Waiting for username input field...');
    await page.waitForSelector(usernameSelector, { state: 'visible', timeout: SELECTOR_TIMEOUT });
    
    // Fill username
    await page.fill(usernameSelector, username);
    await page.waitForTimeout(FORM_INTERACTION_DELAY);
    Logger.log('Filled username field.');

    // Take screenshot BEFORE trying to click "Next"
    await takeScreenshot(page, 'before-next-click');
    Logger.log('Took screenshot before attempting to click "Next" button.');

    // Use a more robust selector to find and click the "Next" button
    const nextButtonLocator = page.locator('button:has-text("Next")').first();
    Logger.log('Waiting for "Next" button to be visible...');
    await nextButtonLocator.waitFor({ state: 'visible', timeout: LOGIN_WAIT_TIMEOUT });
    
    Logger.log('Clicking "Next" button...');
    await nextButtonLocator.click();
    Logger.log('Clicked "Next" after entering username.');

    // Screenshot after clicking 'Next' to see the result
    await takeScreenshot(page, 'after-username-next-click');
    Logger.log('Took screenshot after clicking Next.');
    
    // Wait for a bit for the next page to load
    await page.waitForTimeout(FORM_INTERACTION_DELAY);

    // It's possible Twitter asks for a phone number or email to verify
    // Wait for password field and fill it
    const passwordSelector = 'input[name="password"]';
    Logger.log('Waiting for password input field...');
    await page.waitForSelector(passwordSelector, { state: 'visible', timeout: SELECTOR_TIMEOUT });
    await page.fill(passwordSelector, password);
    await page.waitForTimeout(FORM_INTERACTION_DELAY);

    // Wait for login button to be visible
    const loginButtonSelector = 'button[data-testid="LoginForm_Login_Button"]';
    Logger.log('Waiting for login button...');
    await page.waitForSelector(loginButtonSelector, { state: 'visible', timeout: SELECTOR_TIMEOUT });
    
    // Take screenshot before clicking login button
    await takeScreenshot(page, 'before-login-click');
    
    // Click Login button
    await page.click(loginButtonSelector);
    
    // Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: LOGIN_WAIT_TIMEOUT }).catch(() => {
      Logger.log('Navigation timeout occurred, but continuing...');
    });
    
    // Additional wait to ensure page is fully loaded
    await page.waitForTimeout(5000);
    
    // Take screenshot after login
    await takeScreenshot(page, 'after-login');

    // Verify login success by checking for a unique element on the home page
    await page.waitForURL('**/home', { timeout: 10000 });
    const isLoginSuccessful = page.url().includes('/home');

    if (!isLoginSuccessful) {
      // Take screenshot of failed login state
      await takeScreenshot(page, 'login-failed');
      throw new Error('Login failed: Could not verify Home page after login attempt');
    }
    
    Logger.log('Login successful');
    
    // Save session data
    Logger.log('Saving session data...');
    const storageState = await context.storageState();
    fs.writeFileSync(SESSION_DATA_PATH, JSON.stringify(storageState, null, 2));
    
    await page.close();
    return true;
  } catch (error) {
    Logger.error('Error during login:', error);
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
  // Create session data directory if it doesn't exist
  if (!fs.existsSync(SESSION_DATA_DIR)) {
    fs.mkdirSync(SESSION_DATA_DIR, { recursive: true });
    Logger.log(`Created session data directory: ${SESSION_DATA_DIR}`);
  }
  
  let context;
  let hasValidSession = false;
  
  // Check if we have session data
  if (fs.existsSync(SESSION_DATA_PATH)) {
    Logger.log('Found existing session data, attempting to restore session...');
    try {
      // Load session data
      const sessionData = JSON.parse(fs.readFileSync(SESSION_DATA_PATH, 'utf8'));
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
      Logger.error('Error while restoring session:', error);
      Logger.log('Will attempt fresh login');
      if (context) await context.close();
      context = null;
    }
  } else {
    Logger.log('No session data found, will perform login');
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
        const proxyConfig = {};
        if (PROXY.includes('@')) {
            const [auth, server] = PROXY.split('@');
            const [username, password] = auth.split(':');
            proxyConfig.server = `http://${server}`;
            proxyConfig.username = username;
            proxyConfig.password = password;
        } else {
            proxyConfig.server = `http://${PROXY}`;
        }
        browserOptions.proxy = proxyConfig;
    }
    const browser = await chromium.launch(browserOptions);
    
    try {
        await getAuthenticatedContext(browser);
        console.log('Session refreshed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Failed to refresh session:', error);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

// Execute main function
main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
}); 