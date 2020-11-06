const ChildProcess = require("child_process");
const path = require("path");

const { loadModule } = require("fontoxpath-module-loader");

async function handleMessage(message, mapIterator) {
  if (message.type === "run") {
    const {
      files,
      data: { modules },
    } = message;
    modules.libraries.forEach(loadModule);

    await Promise.all(files.map((...rest) => mapIterator(modules, ...rest)));

    process.send(null);
    return;
  }

  if (message.type === "kill") {
    process.exit();
  }

  throw new Error(
    `xquery-cli child process was given an invalid message type "${message.type}"`
  );
}

module.exports = {
  createChildProcessHandler: (mapIterator) => {
    return async (message) => {
      try {
        await handleMessage(message, mapIterator);
      } catch (error) {
        console.error(
          "> Encountered an unexpected error in xquery-cli child process:"
        );
        console.error("> " + error.stack);
        process.exitCode = 1;
        process.exit();
      }
    };
  },

  // Serially send a bunch of file names off to a child process and call onResult every time there's a result
  evaluateInChildProcesses: (
    childProcessFile,
    files,
    batchSize = Infinity,
    data = {},
    onResult = () => {
      /* no-op */
    }
  ) =>
    (async function readNextBatch(fileList) {
      const currentSlice =
        fileList.length > batchSize ? fileList.slice(0, batchSize) : fileList;
      const nextSlice =
        fileList.length > batchSize ? fileList.slice(batchSize) : [];

      let i = 0;
      const child = ChildProcess.fork(childProcessFile);

      child.on("message", (message) => {
        if (message) {
          return onResult(message, i++);
        }

        // An empty message means end of transmission
        child.send({
          type: "kill",
        });
      });

      child.send({
        type: "run",
        files: currentSlice,
        data,
      });

      await new Promise((resolve, reject) => {
        child.on("close", (exitCode) =>
          exitCode ? reject(exitCode) : resolve()
        );
      });

      if (nextSlice.length) {
        await readNextBatch(nextSlice);
      }
    })(files),
};
