import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

async function run(): Promise<void> {
    try {
        core.warning('Hello, World!');
        await exec.exec('"echo"', ['hello world']);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();

export default run;
