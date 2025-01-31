import {
  getOutfilePath,
  logError,
  logInfo,
  validateDirPath,
  validateFilePath,
  validateOutfileName,
} from '@metamask/snaps-utils';
import chokidar from 'chokidar';

import { YargsArgs } from '../../types/yargs';
import { loadConfig } from '../../utils';
import { bundle } from '../build/bundle';
import { evalHandler } from '../eval/evalHandler';
import { manifestHandler } from '../manifest/manifestHandler';
import { serve } from '../serve/serveHandler';

/**
 * Watch a directory and its subdirectories for changes, and build when files
 * are added or changed.
 *
 * Ignores 'node_modules' and dotfiles.
 * Creates destination directory if it doesn't exist.
 *
 * @param argv - Arguments as an object generated by Yargs.
 * @param argv.src - The source file path.
 * @param argv.dist - The output directory path.
 * @param argv.'outfileName' - The output file name.
 */
export async function watch(argv: YargsArgs): Promise<void> {
  const {
    dist,
    eval: shouldEval,
    manifest,
    outfileName,
    src,
    serve: shouldServe,
  } = argv;
  if (outfileName) {
    validateOutfileName(outfileName);
  }
  await validateFilePath(src);
  await validateDirPath(dist, true);
  const rootDir = src.includes('/')
    ? src.substring(0, src.lastIndexOf('/') + 1)
    : '.';
  const outfilePath = getOutfilePath(dist, outfileName);

  const buildSnap = async (path?: string, logMessage?: string) => {
    if (logMessage !== undefined) {
      logInfo(logMessage);
    }

    try {
      await bundle(src, outfilePath, argv, loadConfig().bundlerCustomizer);

      if (manifest) {
        await manifestHandler(argv);
      }

      if (shouldEval) {
        await evalHandler({ ...argv, bundle: outfilePath });
      }
    } catch (error) {
      logError(
        `Error ${
          path === undefined
            ? 'during initial build'
            : `while processing "${path}"`
        }.`,
        error,
      );
    }
  };

  chokidar
    .watch(rootDir, {
      ignoreInitial: true,
      ignored: [
        '**/node_modules/**',
        `**/${dist}/**`,
        `**/test/**`,
        `**/tests/**`,
        `**/*.test.js`,
        `**/*.test.ts`,
        /* istanbul ignore next */
        (str: string) => str !== '.' && str.startsWith('.'),
      ],
    })

    .on('ready', () => {
      buildSnap()
        .then(() => {
          if (shouldServe) {
            return serve(argv);
          }

          return undefined;
        })
        .catch((error) => {
          logError('Error during initial build.', error);
        });
    })
    .on('add', (path) => {
      buildSnap(path, `File added: ${path}`).catch((error) => {
        logError(`Error while processing "${path}".`, error);
      });
    })
    .on('change', (path) => {
      buildSnap(path, `File changed: ${path}`).catch((error) => {
        logError(`Error while processing "${path}".`, error);
      });
    })
    .on('unlink', (path) => logInfo(`File removed: ${path}`))
    .on('error', (error: Error) => {
      logError(`Watcher error: ${error.message}`, error);
    })

    .add(rootDir);

  logInfo(`Watching '${rootDir}' for changes...`);
}
