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
  
  try {
    Logger.log('Navigating to X.com homepage...');
    await page.goto("https://x.com/home");
    await page.waitForTimeout(PAGE_LOAD_TIMEOUT);
    
    Logger.log(`Attempting to login with username: ${username}`);
    
    // Fill username
    await page.waitForSelector('input[name="text"]', { state: 'visible', timeout: SELECTOR_TIMEOUT });
    await page.fill('input[name="text"]', username);

    // Click Next button
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button[type="button"]'));
      const nextButton = buttons.find(button => button.textContent.includes('Next'));
      if (nextButton) {
        nextButton.click();
      } else {
        throw new Error('Next button not found');
      }
    });
    
    await page.waitForTimeout(PAGE_LOAD_TIMEOUT);

    // Wait for password field and fill it
    await page.waitForSelector('input[name="password"]', { state: 'visible', timeout: SELECTOR_TIMEOUT });
    await page.fill('input[name="password"]', password);
    await page.waitForTimeout(FORM_INTERACTION_DELAY);

    // Wait for login button to be visible
    await page.waitForSelector('button[data-testid="LoginForm_Login_Button"]', { state: 'visible', timeout: SELECTOR_TIMEOUT });
    
    // Take screenshot before clicking login button
    await takeScreenshot(page, 'before-login-click');
    
    // Click Login button
    await page.click('button[data-testid="LoginForm_Login_Button"]');
    
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
    const browser = await chromium.launch({ headless: true });
    
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