import { DefaultReporter } from '@jest/reporters';

/**
 * Jest's default reporter for a spec file that failed, and nothing for one that
 * passed: no line per file and none of its console output. The summary at the
 * end still counts every one, and a failure prints exactly as it always has.
 */
export default class QuietReporter extends DefaultReporter {
  onTestResult(test, result, aggregatedResults) {
    if (result.numFailingTests > 0 || result.testExecError || result.failureMessage) {
      super.onTestResult(test, result, aggregatedResults);
      return;
    }

    this.testFinished(test.context.config, result, aggregatedResults);
    this.forceFlushBufferedOutput();
  }
}
