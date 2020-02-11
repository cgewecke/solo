#!/usr/bin/env node

const API = require('solidity-coverage/api');
const utils = require('solidity-coverage/utils');
const truffleUtils = require('solidity-coverage/plugins/resources/truffle.utils');
const PluginUI = require('solidity-coverage/plugins/resources/truffle.ui');
const pkg = require('solidity-coverage/package.json');
const TruffleConfig = require('@truffle/config');
const death = require('death');
const path = require('path');
const Web3 = require('web3');
const shell = require('shelljs');

async function coverage(){
  let ui;
  let api;
  let error;
  let truffle;
  let config;

  try {
    death(utils.finish.bind(null, config, api)); // Catch interrupt signals

    // =======
    // Configs
    // =======
    const truffleJS = require('./../truffle.js');

    config = (new TruffleConfig()).with(truffleJS)
    config.temp = 'build'       // --temp build
    config.network = 'coverage' // --network coverage

    config = truffleUtils.normalizeConfig(config);

    ui = new PluginUI(config.logger.log);
    truffle = truffleUtils.loadLibrary(config);
    api = new API(utils.loadSolcoverJS(config));

    truffleUtils.setNetwork(config, api);

    // ========
    // Ganache
    // ========
    const client = api.client || truffle.ganache;
    const address = await api.ganache(client);

    const web3 = new Web3(address);
    const accounts = await web3.eth.getAccounts();
    const nodeInfo = await web3.eth.getNodeInfo();
    const ganacheVersion = nodeInfo.split('/')[1];

    truffleUtils.setNetworkFrom(config, accounts);

    // Version Info
    ui.report('versions', [
      truffle.version,
      ganacheVersion,
      pkg.version
    ]);

    // Exit if --version
    if (config.version) return await utils.finish(config, api);

    ui.report('network', [
      config.network,
      config.networks[config.network].network_id,
      config.networks[config.network].port
    ]);

    // =====================
    // Instrument Contracts
    // =====================
    const skipFiles = api.skipFiles || [];

    let {
      targets,
      skipped
    } = utils.assembleFiles(config, skipFiles);

    targets = api.instrument(targets);
    utils.reportSkipped(config, skipped);

    // =================================
    // Filesys and compile configuration
    // =================================
    const {
      tempArtifactsDir,
      tempContractsDir
    } = utils.getTempLocations(config);

    utils.setupTempFolders(config, tempContractsDir, tempArtifactsDir)
    utils.save(targets, config.contracts_directory, tempContractsDir);
    utils.save(skipped, config.contracts_directory, tempContractsDir);

    config.contracts_directory = tempContractsDir;
    config.build_directory = tempArtifactsDir;

    config.contracts_build_directory = path.join(
      tempArtifactsDir,
      path.basename(config.contracts_build_directory)
    );

    config.all = true;
    config.compilers.solc.settings.optimizer.enabled = false;

    // ========
    // Compile
    // ========
    await truffle.contracts.compile(config);

    // ========
    // TS Build
    // ========
    shell.exec('npm run build:cov');

    // ==============
    // Deploy / test
    // ==============

    const command = 'npm run test_cov';
    const finished = 'Force exiting Jest';

    await new Promise(resolve => {
      const child = shell.exec(command, {async: true});

      // Jest routes all output to stderr
      child.stderr.on('data', data => {
        if (data.includes(finished)) resolve()
      });
    });

    // ========
    // Istanbul
    // ========
    await api.report();

  } catch(e){
    error = e;
  }

  // ====
  // Exit
  // ====
  await utils.finish(config, api);

  if (error !== undefined) throw error;
}

// Run coverage
coverage()
  .then(() => process.exit(0))
  .catch(err => process.exit(err));

