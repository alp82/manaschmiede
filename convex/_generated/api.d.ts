/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as decks from "../decks.js";
import type * as generateDeck from "../generateDeck.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_cardFilters from "../lib/cardFilters.js";
import type * as lib_cardPoolQueries from "../lib/cardPoolQueries.js";
import type * as lib_deltaPrompt from "../lib/deltaPrompt.js";
import type * as lib_intentContext from "../lib/intentContext.js";
import type * as lib_jsonLadder from "../lib/jsonLadder.js";
import type * as lib_logLlmUsage from "../lib/logLlmUsage.js";
import type * as lib_strategyParse from "../lib/strategyParse.js";
import type * as lib_strategyQueries from "../lib/strategyQueries.js";
import type * as llmUsageLogs from "../llmUsageLogs.js";
import type * as suggestCombos from "../suggestCombos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  decks: typeof decks;
  generateDeck: typeof generateDeck;
  "lib/anthropic": typeof lib_anthropic;
  "lib/cardFilters": typeof lib_cardFilters;
  "lib/cardPoolQueries": typeof lib_cardPoolQueries;
  "lib/deltaPrompt": typeof lib_deltaPrompt;
  "lib/intentContext": typeof lib_intentContext;
  "lib/jsonLadder": typeof lib_jsonLadder;
  "lib/logLlmUsage": typeof lib_logLlmUsage;
  "lib/strategyParse": typeof lib_strategyParse;
  "lib/strategyQueries": typeof lib_strategyQueries;
  llmUsageLogs: typeof llmUsageLogs;
  suggestCombos: typeof suggestCombos;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
