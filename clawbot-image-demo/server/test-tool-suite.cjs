// test-tool-suite.cjs
// Node.js script to test all registered tools via HTTP API or direct import
// Usage: node test-tool-suite.cjs

const axios = require('axios');

const SERVER_URL = 'http://localhost:8080';

const testCases = [
  {
    tool: 'text.generate',
    args: { prompt: '写一段春节祝福', style: 'festive' },
    desc: '文本生成工具'
  },
  {
    tool: 'image.generate',
    args: { description: '蓝天白云下的城市', size: '1080x1920' },
    desc: '图片生成工具'
  },
  {
    tool: 'file.save',
    args: { content: '测试内容', filename: 'test.txt', format: 'txt' },
    desc: '文件保存工具'
  },
  {
    tool: 'clarify',
    args: { question: '你最喜欢的颜色是什么？' },
    desc: '澄清提问工具'
  },
  {
    tool: 'contacts.apple',
    args: { query: '张三' },
    desc: '查找联系人（macOS）'
  },
  {
    tool: 'platform.send',
    args: { recipientId: 'test-group', recipientName: '测试群组', platform: 'wecom', message: '你好' },
    desc: '企业微信消息发送'
  },
  {
    tool: 'reminders.manage',
    args: { action: 'create', title: '测试提醒', due_date: '2026-03-20' },
    desc: '提醒事项创建'
  },
  {
    tool: 'app.open',
    args: { app: 'WeChat' },
    desc: '打开微信应用'
  },
  {
    tool: 'browser.search_flights',
    args: { origin: '北京', destination: '上海', date: '2026-03-13' },
    desc: '本地浏览器航班搜索'
  },
  {
    tool: 'browser.open_page',
    args: { url: 'https://www.baidu.com' },
    desc: '本地浏览器打开页面'
  },
  {
    tool: 'browser.search_web',
    args: { query: 'OpenAI 是什么' },
    desc: '本地浏览器网页搜索'
  },
  {
    tool: 'browser.compose_gmail_draft',
    args: { to: 'test@example.com', subject: '测试', body: '这是一封测试邮件' },
    desc: 'Gmail 草稿创建'
  },
  {
    tool: 'browser.manage_calendar',
    args: { action: 'create', title: '测试会议', date: '2026-03-20', time: '14:00' },
    desc: '日历事件创建'
  }
  // ...可继续补充其它工具
];

async function runTest() {
  for (const tc of testCases) {
    try {
      const res = await axios.post(`${SERVER_URL}/api/tool/execute`, {
        tool: tc.tool,
        args: tc.args
      });
      console.log(`[PASS] ${tc.desc} (${tc.tool})\n返回:`, res.data);
    } catch (e) {
      console.error(`[FAIL] ${tc.desc} (${tc.tool})\n错误:`, e.response ? e.response.data : e.message);
    }
  }
}

runTest();
