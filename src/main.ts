import * as cache from "@actions/cache";
import * as core from "@actions/core";
import * as exec from "@actions/exec";

async function run(): Promise<void> {
    try {
        const t_version = core.getInput('tarantool-version', { required: true });

        core.warning('Hello, World!');
        core.info('Output to the actions build log')
        await exec.exec('"echo"', ['hello tarantool', t_version]);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();

export default run;
