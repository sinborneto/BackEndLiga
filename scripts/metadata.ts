import { chromium } from "playwright";
const b = await chromium.launch();
try {
  const p = await b.newPage();
  await p.goto(
    "https://www.ligapokemon.com.br/?view=cards%2Fcard&tipo=1&card=Articuno+%28132%2F128%29",
  );
  await p.waitForFunction(() => Array.isArray(window.cards_stock));
  console.log(
    await p.evaluate(() =>
      Array.from(document.querySelectorAll("*"))
        .filter(
          (n) =>
            n.children.length === 0 &&
            /^(Português|Inglês|Japonês|Português \/ Inglês)$/.test(
              n.textContent?.trim() ?? "",
            ),
        )
        .map((n) => n.parentElement?.outerHTML.slice(0, 4000)),
    ),
  );
} finally {
  await b.close();
}
