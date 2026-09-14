const {parentPort,workerData}=require('node:worker_threads');
const core=require('./cube-engine.cjs');
parentPort.postMessage(core.solve(workerData));
