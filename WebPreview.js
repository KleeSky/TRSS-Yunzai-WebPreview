import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import plugin from '../../lib/plugins/plugin.js';
import cfg from "../../lib/config/config.js";

export class WebpageScreenshot extends plugin {
  constructor() {
    super({
      name: '网页截图',
      dsc: '自动识别消息中的链接并截图',
      event: 'message',
      priority: 99999,
      rule: [
        {
          reg: /(?<![`'"])(https?:\/\/[^\s`'")]+|www\.[^\s`'")]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?![`'"])/i,
          fnc: 'autoScreenshot'
        }
      ]
    });

    this.browser = null;
    this.screenshotDir = path.join(process.cwd(), 'data', 'temp');
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  async initBrowserIfNeeded() {
    if (!this.browser) {
      try {
        const executablePath = cfg?.bot?.chromium_path || undefined;

        this.browser = await puppeteer.launch({
          headless: true,
          args: [
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-zygote',
            '--disable-web-security',
            '--allow-file-access-from-files'
          ],
          executablePath: executablePath,
          ignoreHTTPSErrors: true,
        });
      } catch (err) {
        logger.warn("Chromium 启动失败：", err.toString());
      }

      if (!this.browser) {
        logger.warn("puppeteer Chromium 启动失败，请检查你的环境！");
      }
    }
    return this.browser;
  }

  async takeScreenshot(url) {
    const browser = await this.initBrowserIfNeeded();
    if (!browser) return null;

    const page = await browser.newPage();
    try {
      await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 2.55
      });

      await page.goto(url, {
        timeout: 60000,
        waitUntil: "networkidle2"
      });

      const buffer = await page.screenshot({
        type: 'png',
        fullPage: true
      });

      return buffer;
    } catch (err) {
      logger.warn(`截图失败：${url}`, err);
      return null;
    } finally {
      await page.close().catch((err) => logger.warn("关闭页面时出错：", err));
    }
  }

  extractUrls(message) {
    const urlPattern = /(?<![`'"])(https?:\/\/[^\s`'")]+|www\.[^\s`'")]+|[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})(?![`'"])/gi;
    const matches = message.match(urlPattern) || [];
    const urls = matches.map(u => {
      u = u.trim();
      if (!/^https?:\/\//i.test(u)) {
        u = 'http://' + u; // 补全协议头
      }
      return u;
    });
    return urls.length > 0 ? [urls[0]] : []; // 只返回第一个有效链接
  }

  async isValidUrl(url) {
    try {
      const response = await fetch(url, { method: 'HEAD', timeout: 5000 });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async autoScreenshot(e) {
    const urls = this.extractUrls(e.msg);
    if (urls.length === 0) return false;

    // 回复“检测到链接”的消息并引用原始消息
    await e.reply(`发现链接，让我看看这是什么`, { quote: e.message_id });

    const validUrls = [];
    for (const url of urls) {
      if (await this.isValidUrl(url)) {
        validUrls.push(url);
      }
    }

    if (validUrls.length === 0) return false;

    logger.info(`准备进行截图`)

    const screenshotSegments = [];
    const results = await Promise.all(validUrls.map(url => this.processUrl(url)));
    for (const r of results) {
      if (r !== null) {
        screenshotSegments.push(r);
      }
    }

    if (screenshotSegments.length === 0) {
      return true; 
    }

    // 发送文本消息 "好生奇怪的东西" 然后再发送截图
    await e.reply('好生奇怪的东西');
    
    // 发送截图
    for (const seg of screenshotSegments) {
      await e.reply(seg);
    }

    return true;
  }

  async processUrl(url) {
    const imgBuffer = await this.takeScreenshot(url);
    if (!imgBuffer) {
      return null;
    }

    const imageName = `screenshot_${Date.now()}.png`;
    const imagePath = path.join(this.screenshotDir, imageName);
    fs.writeFileSync(imagePath, imgBuffer);

    setTimeout(() => {
      fs.unlink(imagePath, (err) => {
        if (err) logger.warn('删除临时截图文件失败:', err);
      });
    }, 60000);

    return segment.image(imagePath);
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}