import { chromium } from "playwright";
(async () => {
const br = await chromium.launch({ headless: true });
const page = await br.newPage();
console.log("Navigating to Google Flights deep-link...");
await page.goto(
  "https://www.google.com/travel/flights?hl=en#flt=NYC.DTW.2026-03-22;c:USD;e:1;sd:1;t:f",
  { waitUntil: "domcontentloaded", timeout: 30000 }
);
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const q = (s: string) => document.querySelectorAll(s).length;
  return {
    url: location.href.substring(0, 120),
    "li[data-result-index]": q("li[data-result-index]"),
    '[jsname="IWWDBc"]': q('[jsname="IWWDBc"]'),
    ".pIav2d": q(".pIav2d"),
    "li[data-ved]": q("li[data-ved]"),
    "ul li[jsname]": q("ul li[jsname]"),
    '[aria-label*="Departure time"]': q('[aria-label*="Departure time"]'),
    '[class*="YMlIz"]': q('[class*="YMlIz"]'),
    '[class*="wtDjF"]': q('[class*="wtDjF"]'),
    '[class*="AdWm1c"]': q('[class*="AdWm1c"]'),
    '[class*="ZVyLgd"]': q('[class*="ZVyLgd"]'),
    "main ul li": q("main ul li"),
    bodySnippet: document.body.innerText.substring(0, 400),
    liSamples: Array.from(document.querySelectorAll("main li"))
      .slice(0, 8)
      .map((el) => ({
        cls: el.className.substring(0, 70),
        jsname: el.getAttribute("jsname") ?? "",
        dataVed: !!el.getAttribute("data-ved"),
        text: (el as HTMLElement).innerText.substring(0, 50),
      })),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/flights-probe.png" });
await br.close();
})();
