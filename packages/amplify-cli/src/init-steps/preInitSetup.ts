import * as fs from 'fs-extra';
import * as path from 'path';
import * as url from 'url';
import { execSync } from 'child_process';
import {
  pathManager,
  $TSContext,
  NonEmptyDirectoryError,
  exitOnNextTick,
  CLIContextEnvironmentProvider,
  FeatureFlags,
} from 'amplify-cli-core';
import { getPackageManager } from '../packageManagerHelpers';
import { normalizePackageManagerForOS } from '../packageManagerHelpers';
import { generateLocalEnvInfoFile } from './s9-onSuccess';
import { insertAmplifyIgnore } from '../extensions/amplify-helpers/git-manager';

export async function preInitSetup(context: $TSContext) {
  if (context.parameters.options.app) {
    // Setting up a sample app
    context.print.warning('Note: Amplify does not have knowledge of the url provided');
    const repoUrl = context.parameters.options.app;

    await validateGithubRepo(context, repoUrl);
    await cloneRepo(context, repoUrl);
    await installPackage();
    await setLocalEnvDefaults(context);
  }

  if (context.parameters.options.quickstart) {
    await createAmplifySkeleton(context);
    context.usageData.emitSuccess();
    exitOnNextTick(0);
  }

  return context;
}

/**
 * Checks whether a url is a valid remote github repository
 *
 * @param repoUrl the url to validated
 * @throws error if url is not a valid remote github url
 */
async function validateGithubRepo(context: $TSContext, repoUrl: string) {
  try {
    url.parse(repoUrl);

    execSync(`git ls-remote ${repoUrl}`, { stdio: 'ignore' });
  } catch (e) {
    context.print.error('Invalid remote github url');
    context.usageData.emitError(e);
    exitOnNextTick(1);
  }
}

/**
 * Clones repo from url to current directory (must be empty)
 *
 * @param repoUrl the url to be cloned
 */
async function cloneRepo(context: $TSContext, repoUrl: string) {
  const files = fs.readdirSync(process.cwd());

  if (files.length > 0) {
    const errMessage = 'Please ensure you run this command in an empty directory';
    context.print.error(errMessage);
    context.usageData.emitError(new NonEmptyDirectoryError(errMessage));
    exitOnNextTick(1);
  }

  try {
    execSync(`git clone ${repoUrl} .`, { stdio: 'inherit' });
  } catch (e) {
    context.usageData.emitError(e);
    exitOnNextTick(1);
  }
}

/**
 * Install package using the correct package manager if package handling file exists
 *
 * @param packageManager either npm or yarn
 */
async function installPackage() {
  const packageManager = await getPackageManager();
  const normalizedPackageManager = await normalizePackageManagerForOS(packageManager);
  if (normalizedPackageManager) {
    execSync(`${normalizedPackageManager} install`, { stdio: 'inherit' });
  }
}

/**
 * Set the default environment and editor for the local env
 *
 * @param context
 */
async function setLocalEnvDefaults(context: $TSContext) {
  const projectPath = process.cwd();
  const defaultEditor = 'vscode';
  const envName = 'sampledev';
  context.print.warning(`Setting default editor to ${defaultEditor}`);
  context.print.warning(`Setting environment to ${envName}`);
  context.print.warning('Run amplify configure project to change the default configuration later');

  context.exeInfo.localEnvInfo = {
    projectPath,
    defaultEditor,
    envName,
  };

  context.exeInfo.inputParams.amplify.envName = envName;

  await generateLocalEnvInfoFile(context);
}

/**
 * Extract amplify project structure with backend-config and project-config
 */
async function createAmplifySkeleton(context: $TSContext) {
  insertAmplifyIgnore(pathManager.getGitIgnoreFilePath(process.cwd()));

  const skeletonLocalDir = path.join(__dirname, '..', '..', 'templates', 'amplify-skeleton');
  const skeletonProjectDir = path.join(pathManager.getAmplifyDirPath(process.cwd()));

  await fs.copy(skeletonLocalDir, skeletonProjectDir);

  // Initialize feature flags
  const contextEnvironmentProvider = new CLIContextEnvironmentProvider({
    getEnvInfo: () => {
      return context.exeInfo.localEnvInfo;
    },
  });

  if (!FeatureFlags.isInitialized()) {
    await FeatureFlags.initialize(contextEnvironmentProvider, true);
  }

  await FeatureFlags.ensureDefaultFeatureFlags(true);
}
