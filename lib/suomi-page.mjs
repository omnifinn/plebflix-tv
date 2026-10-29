/** The /suomi page: the same app shell with the Suomi share tags, theme colour, tab icon and manifest from share.config.json. */
import cfg from "../share.config.json";
import { applyShareHead } from "./share-head.mjs";
export function suomiPage(html, config = cfg) {
  return applyShareHead(html, config, "suomi");
}
