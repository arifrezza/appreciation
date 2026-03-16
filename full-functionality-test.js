const { chromium } = require('playwright');
const path = require('path');

const SS_DIR = '/Users/arifrezza/.playwright-mcp';
let ssCount = 0;
const ss = async (page, name) => {
  const p = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`📸 ${name}`);
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.accept());

  // ── 1. OPEN APP ─────────────────────────────────────────────────────────────
  console.log('\n=== 1. Opening app ===');
  await page.goto('http://localhost:4200');
  await page.waitForSelector('.login-box', { timeout: 10000 });
  await ss(page, 'f01-login-page');

  // ── 2. LOGIN ────────────────────────────────────────────────────────────────
  console.log('\n=== 2. Logging in ===');
  await page.fill('#email', 'arif@company.com');
  await page.fill('#password', 'password');
  await ss(page, 'f02-credentials-entered');
  await page.click('.login-btn');
  await sleep(2000);
  await ss(page, 'f03-after-login');

  // Check login worked - employee modal should appear
  const employeeModal = page.locator('.modal-content');
  const modalVisible = await employeeModal.isVisible().catch(() => false);
  if (!modalVisible) {
    // Try other credentials
    console.log('  Modal not visible, trying admin@company.com...');
    await page.fill('#email', 'admin@company.com');
    await page.fill('#password', 'password');
    await page.click('.login-btn');
    await sleep(2000);
    await ss(page, 'f03b-after-login-admin');
  }

  // ── 3. SELECT EMPLOYEE ──────────────────────────────────────────────────────
  console.log('\n=== 3. Selecting employee ===');
  await page.waitForSelector('.modal-content', { timeout: 8000 });
  await ss(page, 'f04-employee-modal');

  // Click first available (not already appreciated) employee
  const firstEmployee = page.locator('.employee-item:not(.already-appreciated)').first();
  await firstEmployee.click();
  await sleep(500);
  await ss(page, 'f05-employee-selected');

  // Click Next
  await page.click('.next-btn');
  await sleep(1000);
  await ss(page, 'f06-clicked-next');

  // ── 4. WAIT FOR EDITOR ──────────────────────────────────────────────────────
  console.log('\n=== 4. Editor opened ===');
  await page.waitForSelector('.ql-editor', { timeout: 8000 });
  await sleep(500);
  await ss(page, 'f07-editor-opened');

  const editor = page.locator('.ql-editor');

  // ── TEST 1: ABUSIVE CONTENT ─────────────────────────────────────────────────
  console.log('\n=== TEST 1: Abusive content detection ===');
  await editor.click();
  await page.keyboard.type('You are such an idiot, your work is absolute crap and terrible');
  await sleep(4000); // wait for moderation API
  await ss(page, 'f08-abusive-content');

  const abusiveLabel = page.locator('.guidance-label');
  const abusiveText = await abusiveLabel.textContent().catch(() => '');
  console.log(`  Guidance label: "${abusiveText.trim()}"`);

  const scoreText = await page.locator('.score-value').textContent().catch(() => '0%');
  console.log(`  Score: ${scoreText}`);

  // Check guide items
  const abusiveItem = page.locator('.guide-item').first();
  const abusiveStatus = await abusiveItem.getAttribute('class').catch(() => '');
  console.log(`  Abusive check item class: ${abusiveStatus}`);
  await ss(page, 'f09-abusive-warning-state');

  // Clear text
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await sleep(500);

  // ── TEST 2: SPELL CHECK ─────────────────────────────────────────────────────
  console.log('\n=== TEST 2: Spell check with suggestions ===');
  await editor.click();
  // Type text with intentional typos: "wanna", "apprecaite", "ur"
  await page.keyboard.type('I wanna apprecaite ur eforts on this projetc');
  await sleep(5000); // wait for spell check to process
  await ss(page, 'f10-typos-typed');

  // Check for underlined words (spell check marks them)
  const underlinedSpans = await page.locator('.ql-editor span[style*="text-decoration"]').count().catch(() => 0);
  console.log(`  Underlined (misspelled) words: ${underlinedSpans}`);

  // Try clicking on a misspelled word to show popover
  const spellSpan = page.locator('.ql-editor span[style*="text-decoration"]').first();
  if (await spellSpan.isVisible().catch(() => false)) {
    await spellSpan.click();
    await sleep(1000);
    await ss(page, 'f11-spell-popover-visible');

    const popover = page.locator('.spell-popover');
    if (await popover.isVisible().catch(() => false)) {
      const suggestion = await page.locator('.spell-primary-suggestion').textContent().catch(() => '');
      console.log(`  Spell suggestion: "${suggestion.trim()}"`);
      await ss(page, 'f12-spell-suggestion');

      // Click the suggestion to apply it
      await page.locator('.spell-primary-block').click();
      await sleep(500);
      await ss(page, 'f13-spell-suggestion-applied');
      console.log('  Spell suggestion applied');
    }
  } else {
    console.log('  No underlined words found, checking for spell check popover another way...');
    await ss(page, 'f11-no-spell-underline');
  }

  // ── TEST 3: GHOST TEXT / TAB ────────────────────────────────────────────────
  console.log('\n=== TEST 3: Ghost text and Tab key ===');
  // Clear and type fresh text that triggers ghost text
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await sleep(300);
  await page.keyboard.type('I appreciate your outstanding work on the project. You have shown great');
  await sleep(4000); // wait for ghost text suggestion to appear
  await ss(page, 'f14-before-ghost-text');

  const ghostOverlay = page.locator('.ghost-overlay');
  const ghostVisible = await ghostOverlay.isVisible().catch(() => false);
  console.log(`  Ghost text visible: ${ghostVisible}`);

  if (ghostVisible) {
    const ghostContent = await page.locator('.ghost-completion').textContent().catch(() => '');
    console.log(`  Ghost text: "${ghostContent}"`);
    await ss(page, 'f15-ghost-text-showing');

    // Press Tab to append
    await page.keyboard.press('Tab');
    await sleep(1000);
    await ss(page, 'f16-after-tab-appended');
    console.log('  Tab pressed - ghost text appended');
  } else {
    console.log('  No ghost text visible after wait');
    await ss(page, 'f15-no-ghost-text');
  }

  // ── BUILD UP FOR AI ENHANCE ─────────────────────────────────────────────────
  console.log('\n=== Building sufficient text for AI enhance ===');
  await editor.click();
  await page.keyboard.press('End');
  const currentText = await editor.textContent().catch(() => '');
  console.log(`  Current text length: ${currentText.length} chars`);

  if (currentText.length < 50) {
    await page.keyboard.type(' dedication to quality and team collaboration has been truly inspiring for everyone. Thank you for your consistent effort.');
    await sleep(2000);
  }
  await ss(page, 'f17-text-ready-for-enhance');

  const charCount = await page.locator('.char-count').textContent().catch(() => '0');
  console.log(`  Char count: ${charCount}`);

  // ── TEST 4: ENHANCE WITH AI ─────────────────────────────────────────────────
  console.log('\n=== TEST 4: Enhance with AI ===');
  const enhanceBtn = page.locator('.rewrite-btn, button:has-text("Enhance")');
  const isEnabled = await enhanceBtn.isEnabled().catch(() => false);
  console.log(`  Enhance with AI enabled: ${isEnabled}`);
  await ss(page, 'f18-before-enhance');

  if (isEnabled) {
    await enhanceBtn.click();
    console.log('  Waiting for AI response...');
    await sleep(8000);
    await ss(page, 'f19-ai-response');

    const aiBox = page.locator('.ai-suggestion');
    const aiVisible = await aiBox.isVisible().catch(() => false);
    console.log(`  AI suggestion box visible: ${aiVisible}`);

    if (aiVisible) {
      const aiText = await page.locator('.ai-text').inputValue().catch(() => '');
      console.log(`  AI text (first 100): "${aiText.substring(0, 100)}..."`);
      await ss(page, 'f20-ai-suggestion-shown');

      // ── TEST 5: USE AI SUGGESTION ─────────────────────────────────────────
      console.log('\n=== TEST 5: Using AI suggestion ===');
      const useBtn = page.locator('.use-btn, button:has-text("Use Suggestion")');
      if (await useBtn.isVisible().catch(() => false)) {
        await useBtn.click();
        await sleep(1500);
        await ss(page, 'f21-ai-text-applied');
        console.log('  AI suggestion applied to editor');
      }
    }
  } else {
    console.log('  Enhance with AI not enabled. Adding more text...');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Your work ethic and positive attitude make a real difference to our team culture and productivity every single day.');
    await sleep(2000);
    const newCharCount = await page.locator('.char-count').textContent().catch(() => '0');
    console.log(`  New char count: ${newCharCount}`);
    await ss(page, 'f18b-more-text-added');

    if (await enhanceBtn.isEnabled().catch(() => false)) {
      await enhanceBtn.click();
      await sleep(8000);
      await ss(page, 'f19b-ai-response');
    }
  }

  // ── SCORE / GUIDE ITEMS ─────────────────────────────────────────────────────
  console.log('\n=== Final score and guide items ===');
  const finalScore = await page.locator('.score-value').textContent().catch(() => 'N/A');
  console.log(`  Final score: ${finalScore}`);

  const guideItems = await page.locator('.guide-item').all();
  for (const item of guideItems) {
    const label = await item.locator('span').first().textContent().catch(() => '');
    const cls = await item.getAttribute('class').catch(() => '');
    const status = cls.includes('success') ? '✓' : cls.includes('error') ? '✕' : '●';
    console.log(`  ${status} ${label.trim()}`);
  }
  await ss(page, 'f22-final-score-guide');

  // ── TEST 6: POST ────────────────────────────────────────────────────────────
  console.log('\n=== TEST 6: Posting appreciation ===');
  const postBtn = page.locator('.submit-btn');
  const postEnabled = await postBtn.isEnabled().catch(() => false);
  console.log(`  POST button enabled: ${postEnabled}`);
  await ss(page, 'f23-pre-post');

  if (postEnabled) {
    await postBtn.click();
    await sleep(3000);
    await ss(page, 'f24-post-result');
    console.log('  Appreciation posted!');
  }

  // ── DONE ────────────────────────────────────────────────────────────────────
  console.log('\n=== Test complete ===');
  await ss(page, 'f25-final');
  await sleep(2000);
  await browser.close();
})().catch(async (err) => {
  console.error('\nTest error:', err.message);
  process.exit(1);
});
