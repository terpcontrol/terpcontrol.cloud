import { DefaultReporter } from '@jest/reporters';

/**
 * Jest's default reporter for a spec file that failed or wrote to the console,
 * and nothing for one that passed without a word: no line per file. A spec
 * that passes while it, the code under test or a library complains is hiding
 * a fault, so that output is printed with its file, the way the webapp's
 * tests print it, and is to be fixed rather than filtered. The summary at the
 * end still counts every file, and a failure prints exactly as it always has.
 */
export default class QuietReporter extends DefaultReporter {
  onTestResult(test, result, aggregatedResults) {
    if (result.numFailingTests > 0 || result.testExecError || result.failureMessage || result.console?.length) {
      super.onTestResult(test, result, aggregatedResults);
      return;
    }

    this.testFinished(test.context.config, result, aggregatedResults);
    this.forceFlushBufferedOutput();
  }
}
