// Validado em 23/10/2026 nos option[value] de #collection_quality e #bazar_quality.
const quality: Record<string, string> = {
  "0": "Não definida",
  "1": "M",
  "2": "NM",
  "3": "SP",
  "4": "MP",
  "5": "HP",
  "6": "D",
};
const finish: Record<string, string> = {
  "0": "Normal",
  "2": "Foil",
  "14": "Foil Promo",
  "34": "Foil Alterada",
};
export const mapQuality = (code: unknown) => quality[String(code)] ?? null;
export const mapFinish = (code: unknown) => finish[String(code)] ?? null;
// Validado em 22/10/2026 nos option[value] de #compralista-language e ícones data-image.
const languages: Record<string, string> = {
  "0": "Não definido",
  "1": "Alemão",
  "2": "Inglês",
  "3": "Espanhol",
  "4": "Francês",
  "5": "Italiano",
  "6": "Japonês",
  "7": "Coreano",
  "8": "Português",
  "9": "Russo",
  "10": "Chinês",
  "11": "Português / Inglês",
  "12": "Chinês Simplificado",
  "17": "Tailandês",
  "18": "Polonês",
  "19": "Indonésio",
};
export const mapLanguage = (code: unknown) => languages[String(code)] ?? null;
