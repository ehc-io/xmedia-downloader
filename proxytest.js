#!/usr/bin/env node
/**
 * test_proxy.js
 * 
 * Tests proxy connectivity using Playwright within the container.
 * Usage: node test_proxy.js [URL]
 * Default URL: https://ifconfig.me
 * 
 * This will show your public IP to verify if proxy is working.
 */

const { chromium } = require('playwright');

// Configuration
const TEST_URL = process.argv[2] || 'https://ifconfig.me';
const PROXY = process.env.PROXY;
const SCREENSHOTS = process.env.SCREENSHOTS === 'true';

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

async function testProxy() {
    log('\n=== Playwright Proxy Test ===\n', 'bright');
    
    // Display configuration
    log('Configuration:', 'cyan');
    log(`  Test URL: ${TEST_URL}`, 'blue');
    log(`  PROXY env: ${PROXY || 'Not set'}`, 'blue');
    
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
            userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        // Set up request logging
        page.on('request', request => {
            if (request.url() === TEST_URL) {
                log(`\nMaking request to: ${request.url()}`, 'cyan');
            }
        });
        
        page.on('response', response => {
            if (response.url() === TEST_URL) {
                log(`Response status: ${response.status()} ${response.statusText()}`, 
                    response.status() === 200 ? 'green' : 'red');
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
            
            // Get page content
            const content = await page.content();
            const textContent = await page.textContent('body');
            
            // Take screenshot if requested
            if (SCREENSHOTS) {
                const screenshotPath = `proxy-test-${Date.now()}.png`;
                await page.screenshot({ path: screenshotPath, fullPage: true });
                log(`\nScreenshot saved: ${screenshotPath}`, 'magenta');
            }
            
            // Display results
            log('\n=== Results ===', 'bright');
            
            // For IP checking services
            if (TEST_URL.includes('ifconfig.me') || TEST_URL.includes('ipinfo.io') || 
                TEST_URL.includes('icanhazip.com') || TEST_URL.includes('api.ipify.org')) {
                const ip = textContent.trim();
                log(`Your public IP address: ${ip}`, 'green');
                
                if (PROXY) {
                    log('\nProxy appears to be working! The IP shown should be your proxy\'s IP.', 'green');
                    log('Verify this matches your proxy provider\'s IP address.', 'yellow');
                } else {
                    log('\nNo proxy configured. This should be your direct connection IP.', 'yellow');
                }
            } else {
                // For other URLs, show page title and a snippet
                const title = await page.title();
                log(`Page title: ${title}`, 'green');
                log(`\nPage content (first 200 chars):`, 'cyan');
                log(textContent.substring(0, 200).trim() + '...', 'reset');
            }
            
            // Test additional endpoints if it's an IP service
            if (TEST_URL.includes('ifconfig.me')) {
                log('\n=== Additional IP Info ===', 'bright');
                
                try {
                    // Get user agent
                    await page.goto('https://ifconfig.me/ua', { timeout: 10000 });
                    const userAgent = await page.textContent('body');
                    log(`User Agent: ${userAgent.trim()}`, 'blue');
                    
                    // Get more details
                    await page.goto('https://ifconfig.me/all', { timeout: 10000 });
                    const allInfo = await page.textContent('body');
                    log('\nFull connection info:', 'cyan');
                    console.log(allInfo.trim());
                } catch (error) {
                    log('Could not fetch additional info', 'yellow');
                }
            }
            
        } catch (navigationError) {
            log(`\nNavigation failed: ${navigationError.message}`, 'red');
            
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