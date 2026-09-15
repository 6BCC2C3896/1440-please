#!/usr/bin/env node
"use strict";
const Core = require("../lib/core.js");
const levels=[720,1080,1440,2160];
function decide(input){return Core.twoStageQualityDecision({nowMs:30000,currentHeight:1440,mode:"preferred",effectiveBuffer:30,bufferTrend:0,playing:true,riskEvent:false,availableHeights:levels,lowSinceMs:null,stableSinceMs:null,driftSinceMs:null,lastAdjustmentMs:0,transitionUntilMs:0,fallbackSinceMs:0,...input});}
const checks=[
  ["step-growth-1440", decide({effectiveBuffer:28,bufferTrend:-2}), "hold"],
  ["near-empty-risk", decide({nowMs:70000,preferredSinceMs:10000,lastAdjustmentMs:50000,effectiveBuffer:1.0,bufferTrend:-2,capacityTrend:-0.5,riskEvent:true,lowSinceMs:68000}), "switch-fallback"],
  ["upshift-reset-grace", decide({nowMs:35000,mode:"transition-preferred",transitionUntilMs:40000,lastAdjustmentMs:30000,effectiveBuffer:0.1,bufferTrend:-30,riskEvent:true}), "hold"],
  ["upshift-post-grace", decide({nowMs:41000,mode:"transition-preferred",transitionUntilMs:40000,lastAdjustmentMs:30000,effectiveBuffer:12,bufferTrend:2}), "commit-preferred"]
];
let failed=false;
for(const [scenario,result,expected] of checks){console.log(JSON.stringify({scenario,result}));if(result.action!==expected)failed=true;}
if(failed)process.exitCode=1;
