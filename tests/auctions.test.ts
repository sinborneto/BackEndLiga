import { expect, it } from "vitest";
import fixture from "./fixtures/auctions.json";
import { mapAuctions } from "../src/mappers/auctions.js";
import { mapOffers, filterResult } from "../src/services/marketplace.service.js";
import { querySchema, resultSchema, type RawOffer } from "../src/types/card.types.js";
import { BatchPricesService } from "../src/services/batch-prices.service.js";
import { createBatchSchema } from "../src/types/batch.types.js";
const raw = fixture as unknown as RawOffer[];
const now = Date.parse("2026-10-23T12:00:00.000Z");
it("mapeia os dois anúncios reais com lance, preço fixo, encerramento e vendedor", () => {
  const auctions = mapAuctions(raw,now);
  expect(auctions).toHaveLength(2);
  expect(auctions[0]).toMatchObject({auctionId:5669526,bidPrice:1000,fixedPrice:1200,bidIncrement:50,bids:0,endsAt:"2026-10-23T14:06:02.000Z",seller:"Vini94",state:"RJ",quality:"NM",finish:"Foil Promo",language:"Japonês",referencesCount:0,positivePercent:null,acceptsLigaSegura:true});
  expect(new URL(auctions[0].url!).searchParams.get("view")).toBe("leilao/view");
  expect(new URL(auctions[0].url!).searchParams.get("id")).toBe("5669526");
  expect(auctions[1]).toMatchObject({bidPrice:null,fixedPrice:330,bidIncrement:null,bids:0,seller:"brgds",referencesCount:13,positivePercent:100});
});
it("mantém valores ausentes desconhecidos e omite anúncios encerrados", () => {
  const [auction] = mapAuctions([{sellType:2,id:1,lj_id:0,title:"Anúncio",price:"inválido",bids:-1,dtEnd:"inválido"}],now);
  expect(auction).toMatchObject({bidPrice:null,fixedPrice:null,bids:null,endsAt:null,seller:null,referencesCount:null,acceptsLigaSegura:null});
  expect(mapAuctions(raw,Date.parse("2026-10-28T00:00:00Z"))).toEqual([]);
});
it("separa totais, estatísticas e filtros de lojas e leilões também no lote", async () => {
  const offers = mapOffers([...raw,{id:1,lj_id:1,preco:199,quant:2,qualid:2,idioma:8}],{"1":{lj_name:"Loja",lj_uf:"SP"}},{glyphs:{},profiles:[],diagnostics:[]});
  expect(offers).toHaveLength(1);
  const result = resultSchema.parse({card:{name:"Pikachu",number:"001/007",edition:"WOTCP"},source:"Liga Pokémon",collectedAt:"2026-10-23T12:00:00Z",totalOffers:1,offers,auctions:mapAuctions(raw,now),totalAuctions:2,diagnostics:{pricesDecoded:1,pricesPending:0,stocksDecoded:1,stocksPending:0,messages:[]}});
  const filtered = filterResult(result,querySchema.parse({card:"Pikachu",quality:"NM",language:"Japonês",state:"RJ",minPrice:2000,minStock:99}));
  expect(filtered.totalOffers).toBe(0); expect(filtered.totalAuctions).toBe(1);
  expect(filtered.auctions?.[0].seller).toBe("Vini94");
  const batch = await new BatchPricesService({getPrices:async()=>result}).getPrices(createBatchSchema().parse({cards:["Pikachu"]}));
  expect(batch.summary).toMatchObject({totalOffers:1,totalAuctions:2});
  expect(batch.results[0]).toMatchObject({statistics:{minPrice:199,averagePrice:199,totalStock:2,unknownStockOffers:0,storesCount:1}});
});
