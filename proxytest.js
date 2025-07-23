#!/usr/bin/env node
/**
 * test_proxy.js
 * 
 * Tests proxy connectivity using Playwright within the container.
 * Usage: node test_proxy.js [URL]
 * Default URL: https://ifconfig.me
 * 
 * For IP check URLs: Shows your public IP to verify proxy
 * For other URLs: Takes a screenshot to verify page loads correctly
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// GCS upload capability (optional - will work without it)
let Storage;
try {
    Storage = require('@google-cloud/storage').Storage;
} catch (e) {
    // GCS library not available, will only save locally
}

// Configuration
const TEST_URL = process.argv[2] || 'https://ifconfig.me';
const PROXY = process.env.PROXY;
const SCREENSHOTS_DIR = 'screenshots';
const GCS_BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const UPLOAD_TO_GCS = process.env.UPLOAD_TO_GCS === 'true';

// IP checking service URLs
const IP_CHECK_URLS = [
    'ifconfig.me',
    'api.ipify.org',
    'icanhazip.com',
    'httpbin.org/ip',
    'checkip.amazonaws.com',
    'ipinfo.io',
    'wtfismyip.com',
    'ip-api.com'
];

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function getFormattedTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function ensureDirectoryExists(directory) {
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
        log(`Created directory: ${directory}`, 'green');
    }
}

function isIPCheckURL(url) {
    return IP_CHECK_URLS.some(ipService => url.includes(ipService));
}

function parseProxy(proxyString) {
    if (!proxyString) return null;
    
    try {
        // Handle user:pass@host:port format
        if (proxyString.includes('@')) {
            const [auth, server] = proxyString.split('@');
            const [username, password] = auth.split(':');
            return {
                server: `http://${server}`,
                username: username,
                password: password
            };
        } else {
            // Handle simple host:port format
            return {
                server: `http://${proxyString}`
            };
        }
    } catch (error) {
        log(`Error parsing proxy string: ${error.message}`, 'red');
        return null;
    }
}

async function uploadToGCS(localPath, blobName) {
    if (!Storage || !GCS_BUCKET_NAME || !UPLOAD_TO_GCS) {
        return false;
    }
    
    try {
        const storage = new Storage();
        const bucket = storage.bucket(GCS_BUCKET_NAME);
        await bucket.upload(localPath, {
            destination: blobName,
        });
        log(`  Uploaded to GCS: ${blobName}`, 'green');
        return true;
    } catch (error) {
        log(`  Failed to upload to GCS: ${error.message}`, 'yellow');
        return false;
    }
}

async function takeScreenshot(page, filename) {
    ensureDirectoryExists(SCREENSHOTS_DIR);
    const timestamp = getFormattedTimestamp();
    const screenshotFilename = `${timestamp}-${filename}.png`;
    const localPath = path.join(SCREENSHOTS_DIR, screenshotFilename);
    
    await page.screenshot({ path: localPath, fullPage: true });
    log(`Screenshot saved locally: ${localPath}`, 'magenta');
    
    // Try to upload to GCS if configured
    if (GCS_BUCKET_NAME && UPLOAD_TO_GCS) {
        const gcsBlobName = `media/screenshots/proxy-test-${screenshotFilename}`;
        await uploadToGCS(localPath, gcsBlobName);
    }
    
    return localPath;
}

async function testProxy() {
    log('\n=== Playwright Proxy Test ===\n', 'bright');
    
    // Display configuration
    log('Configuration:', 'cyan');
    log(`  Test URL: ${TEST_URL}`, 'blue');
    log(`  PROXY env: ${PROXY || 'Not set'}`, 'blue');
    log(`  Screenshot directory: ${SCREENSHOTS_DIR}`, 'blue');
    
    if (GCS_BUCKET_NAME) {
        log(`  GCS Bucket: ${GCS_BUCKET_NAME}`, 'blue');
        log(`  Upload to GCS: ${UPLOAD_TO_GCS ? 'Yes' : 'No (set UPLOAD_TO_GCS=true to enable)'}`, 'blue');
        if (!Storage) {
            log(`  ⚠️  GCS library not installed - screenshots will only be saved locally`, 'yellow');
        }
    }
    
    // Parse proxy configuration
    const proxyConfig = parseProxy(PROXY);
    if (PROXY && proxyConfig) {
        log(`  Parsed proxy server: ${proxyConfig.server}`, 'green');
        if (proxyConfig.username) {
            log(`  Proxy auth: ${proxyConfig.username}:****`, 'green');
        }
    } else if (PROXY) {
        log('  Failed to parse proxy configuration!', 'red');
    } else {
        log('  No proxy configured - using direct connection', 'yellow');
    }
    
    let browser;
    try {
        // Launch browser with or without proxy
        log('\nLaunching browser...', 'cyan');
        const launchOptions = {
            headless: true,
            args: ['--no-sandbox'] // Helpful in container environments
        };
        
        if (proxyConfig) {
            launchOptions.proxy = proxyConfig;
            log('Browser configured with proxy settings', 'green');
        }
        
        browser = await chromium.launch(launchOptions);
        log('Browser launched successfully', 'green');
        
        // Create context and page
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();
        
        // Set up request/response logging
        let requestCount = 0;
        let failedRequests = 0;
        
        page.on('request', request => {
            requestCount++;
            if (request.url() === TEST_URL) {
                log(`\nMaking request to: ${request.url()}`, 'cyan');
            }
        });
        
        page.on('requestfailed', request => {
            failedRequests++;
            log(`Request failed: ${request.url()} - ${request.failure().errorText}`, 'red');
        });
        
        page.on('response', response => {
            if (response.url() === TEST_URL) {
                log(`Response status: ${response.status()} ${response.statusText()}`, 
                    response.status() === 200 ? 'green' : 'red');
                
                // Log response headers if debugging
                if (process.env.DEBUG) {
                    const headers = response.headers();
                    log('\nResponse headers:', 'cyan');
                    Object.entries(headers).forEach(([key, value]) => {
                        console.log(`  ${key}: ${value}`);
                    });
                }
            }
        });
        
        // Navigate to test URL
        log(`\nNavigating to ${TEST_URL}...`, 'cyan');
        const startTime = Date.now();
        
        try {
            const response = await page.goto(TEST_URL, {
                waitUntil: 'networkidle',
                timeout: 30000
            });
            
            const loadTime = Date.now() - startTime;
            log(`Page loaded in ${loadTime}ms`, 'green');
            log(`Total requests: ${requestCount}, Failed: ${failedRequests}`, 'blue');
            
            // Get page info
            const title = await page.title();
            const url = page.url();
            
            log(`\nPage title: ${title}`, 'green');
            if (url !== TEST_URL) {
                log(`Final URL (after redirects): ${url}`, 'yellow');
            }
            
            // Handle IP check services
            if (isIPCheckURL(TEST_URL)) {
                const textContent = await page.textContent('body');
                const ip = textContent.trim().split('\n')[0]; // Get first line for multi-line responses
                
                log('\n=== IP Check Results ===', 'bright');
                log(`Your public IP address: ${ip}`, 'green');
                
                if (PROXY) {
                    log('\nProxy appears to be working! The IP shown should be your proxy\'s IP.', 'green');
                    log('Verify this matches your proxy provider\'s IP address.', 'yellow');
                } else {
                    log('\nNo proxy configured. This should be your direct connection IP.', 'yellow');
                }
                
                // Take screenshot for IP check too
                await takeScreenshot(page, 'ip-check-result');
                
                // For ifconfig.me, get additional info
                if (TEST_URL.includes('ifconfig.me') && !TEST_URL.includes('/ip')) {
                    log('\n=== Additional IP Info ===', 'bright');
                    
                    try {
                        // Get user agent
                        await page.goto('https://ifconfig.me/ua', { timeout: 10000 });
                        const userAgent = await page.textContent('body');
                        log(`User Agent: ${userAgent.trim()}`, 'blue');
                        
                        // Get JSON data if available
                        await page.goto('https://ifconfig.me/all.json', { timeout: 10000 });
                        const jsonText = await page.textContent('body');
                        const data = JSON.parse(jsonText);
                        log('\nConnection details:', 'cyan');
                        Object.entries(data).forEach(([key, value]) => {
                            console.log(`  ${key}: ${value}`);
                        });
                    } catch (error) {
                        log('Could not fetch additional info', 'yellow');
                    }
                }
            } else {
                // For non-IP check URLs, take screenshot and show page info
                log('\n=== Page Load Results ===', 'bright');
                
                // Wait a bit for dynamic content to load
                await page.waitForTimeout(2000);
                
                // Take screenshot
                const screenshotName = `proxy-test-${new URL(TEST_URL).hostname.replace(/\./g, '-')}`;
                const screenshotPath = await takeScreenshot(page, screenshotName);
                
                // Get page metrics
                const metrics = await page.evaluate(() => {
                    return {
                        documentHeight: document.documentElement.scrollHeight,
                        documentWidth: document.documentElement.scrollWidth,
                        imageCount: document.images.length,
                        linkCount: document.links.length,
                        scriptCount: document.scripts.length
                    };
                });
                
                log(`Page metrics:`, 'cyan');
                log(`  Document size: ${metrics.documentWidth}x${metrics.documentHeight}px`, 'blue');
                log(`  Images: ${metrics.imageCount}`, 'blue');
                log(`  Links: ${metrics.linkCount}`, 'blue');
                log(`  Scripts: ${metrics.scriptCount}`, 'blue');
                
                // Show a preview of the text content
                const textContent = await page.textContent('body');
                const cleanText = textContent.replace(/\s+/g, ' ').trim();
                if (cleanText.length > 0) {
                    log(`\nPage content preview (first 300 chars):`, 'cyan');
                    log(cleanText.substring(0, 300) + (cleanText.length > 300 ? '...' : ''), 'reset');
                }
                
                // Check for common indicators of blocked content
                const blockedIndicators = [
                    'access denied',
                    'forbidden',
                    'blocked',
                    'not available in your country',
                    'error 403',
                    'cloudflare',
                    'please verify you are human'
                ];
                
                const pageContent = (title + ' ' + cleanText).toLowerCase();
                const possiblyBlocked = blockedIndicators.some(indicator => 
                    pageContent.includes(indicator)
                );
                
                if (possiblyBlocked) {
                    log('\n⚠️  Page might be blocking proxy access!', 'yellow');
                    log('Check the screenshot to verify if content loaded correctly.', 'yellow');
                }
                
                log(`\n✅ Page loaded successfully! Check screenshot: ${screenshotPath}`, 'green');
            }
            
        } catch (navigationError) {
            log(`\nNavigation failed: ${navigationError.message}`, 'red');
            
            // Try to take a screenshot of the error state
            try {
                await takeScreenshot(page, 'error-state');
                log('Screenshot of error state saved', 'yellow');
            } catch (screenshotError) {
                log('Could not capture error screenshot', 'yellow');
            }
            
            if (navigationError.message.includes('net::ERR_PROXY_CONNECTION_FAILED')) {
                log('\nProxy connection failed! Check:', 'red');
                log('  1. Proxy server address is correct', 'yellow');
                log('  2. Proxy credentials are valid', 'yellow');
                log('  3. Proxy server is accessible from this container', 'yellow');
            } else if (navigationError.message.includes('net::ERR_TUNNEL_CONNECTION_FAILED')) {
                log('\nProxy tunnel connection failed! This often means:', 'red');
                log('  - Invalid proxy credentials', 'yellow');
                log('  - Proxy server rejected the connection', 'yellow');
            } else if (navigationError.message.includes('timeout')) {
                log('\nRequest timed out! Possible causes:', 'red');
                log('  - Proxy server is slow or unresponsive', 'yellow');
                log('  - Target website is blocking proxy IPs', 'yellow');
                log('  - Network connectivity issues', 'yellow');
            } else if (navigationError.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
                log('\nDNS resolution failed!', 'red');
                log('  - Check if the URL is correct', 'yellow');
                log('  - Verify DNS is working in the container', 'yellow');
            }
            
            throw navigationError;
        }
        
    } catch (error) {
        log(`\nError during test: ${error.message}`, 'red');
        if (error.stack && process.env.DEBUG) {
            log('\nStack trace:', 'red');
            console.error(error.stack);
        }
        process.exit(1);
    } finally {
        if (browser) {
            await browser.close();
            log('\nBrowser closed', 'cyan');
        }
    }
    
    log('\n=== Test completed successfully ===\n', 'green');
}

// Main execution
if (process.argv.length > 3) {
    log('Usage: node test_proxy.js [URL]', 'yellow');
    log('Example: node test_proxy.js https://example.com', 'yellow');
    process.exit(1);
}

// Run the test
testProxy().catch(error => {
    log(`\nUnexpected error: ${error.message}`, 'red');
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    log('\n\nReceived SIGINT, shutting down...', 'yellow');
    process.exit(0);
});