/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bench from "../bench.js";
import type * as generateDeck from "../generateDeck.js";
import type * as lib_anthropic from "../lib/anthropic.js";
import type * as lib_basicLands from "../lib/basicLands.js";
import type * as lib_benchScenario from "../lib/benchScenario.js";
import type * as lib_cardFilters from "../lib/cardFilters.js";
import type * as lib_cardPoolQueries from "../lib/cardPoolQueries.js";
import type * as lib_deckRules from "../lib/deckRules.js";
import type * as lib_deltaPrompt from "../lib/deltaPrompt.js";
import type * as lib_gatewayShapes from "../lib/gatewayShapes.js";
import type * as lib_intentContext from "../lib/intentContext.js";
import type * as lib_jsonLadder from "../lib/jsonLadder.js";
import type * as lib_logLlmUsage from "../lib/logLlmUsage.js";
import type * as lib_mechanicalGate from "../lib/mechanicalGate.js";
import type * as lib_mechanicalGateCheck from "../lib/mechanicalGateCheck.js";
import type * as lib_openRouter from "../lib/openRouter.js";
import type * as lib_parseCardList from "../lib/parseCardList.js";
import type * as lib_responseSchemas from "../lib/responseSchemas.js";
import type * as lib_responseShapes from "../lib/responseShapes.js";
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
  bench: typeof bench;
  generateDeck: typeof generateDeck;
  "lib/anthropic": typeof lib_anthropic;
  "lib/basicLands": typeof lib_basicLands;
  "lib/benchScenario": typeof lib_benchScenario;
  "lib/cardFilters": typeof lib_cardFilters;
  "lib/cardPoolQueries": typeof lib_cardPoolQueries;
  "lib/deckRules": typeof lib_deckRules;
  "lib/deltaPrompt": typeof lib_deltaPrompt;
  "lib/gatewayShapes": typeof lib_gatewayShapes;
  "lib/intentContext": typeof lib_intentContext;
  "lib/jsonLadder": typeof lib_jsonLadder;
  "lib/logLlmUsage": typeof lib_logLlmUsage;
  "lib/mechanicalGate": typeof lib_mechanicalGate;
  "lib/mechanicalGateCheck": typeof lib_mechanicalGateCheck;
  "lib/openRouter": typeof lib_openRouter;
  "lib/parseCardList": typeof lib_parseCardList;
  "lib/responseSchemas": typeof lib_responseSchemas;
  "lib/responseShapes": typeof lib_responseShapes;
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
