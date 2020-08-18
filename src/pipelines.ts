import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as cp from 'child_process';
import { Script } from 'vm';
import { prototype } from 'events';
import { State } from './state';
import { Pipe } from 'stream';
import { getVSCodeDownloadUrl } from 'vscode-test/out/util';

class Repository {

   constructor(public readonly url: string, public readonly hub?: string, public readonly tag?: string) {
   }
}

export class Pipeline {

   public mtimeMs: number = 0;

   constructor(public readonly name: string,
               public storagePath: vscode.Uri,
               public config: Array<vscode.Uri> = new Array<vscode.Uri>(),
               public option: Array<string> = new Array<string>(),
               public arg: Array<string> = new Array<string>(),
               public profile?: string,
               public params?: vscode.Uri,
               public script?: vscode.Uri,
               public repo?: Repository) {
   }
}

class PipelineResources {

   outputCh: vscode.OutputChannel;
   nextflow: cp.ChildProcess | undefined = undefined;

   constructor(public readonly name: string) {
      this.outputCh = vscode.window.createOutputChannel(name + " - Nextflow Sandbox");
   }
}

export class Dependency extends vscode.TreeItem {

   constructor(readonly name: string,
               readonly contextValue?: string,
               readonly collapsibleState?: vscode.TreeItemCollapsibleState,
               readonly resourceUri?: vscode.Uri,
               readonly command?: vscode.Command,
               readonly pipeline?: string) {
      super(name, collapsibleState);
   }

   get tooltip(): string | undefined {
      return this.resourceUri?.fsPath;
   }

   get description(): string | undefined {
      if (this.contextValue === 'running') {
         return '[' + this.contextValue + ']';
      }
      return undefined;
   }
}

export class PipelinesTreeDataProvider implements vscode.TreeDataProvider<Dependency> {

   private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined> = new vscode.EventEmitter<Dependency | undefined>();
   readonly onDidChangeTreeData: vscode.Event<Dependency | undefined> = this._onDidChangeTreeData.event;
   private nameToResourcesMap: { [name: string]: PipelineResources; } = { };

   constructor(private context: vscode.ExtensionContext,
               private state: State,
               private on: (event: string, pipeline: string) => void | undefined) {
   }

   private pipelineResources(name: string): PipelineResources {
      const res = this.nameToResourcesMap[name] || new PipelineResources(name);
      this.nameToResourcesMap[name] = res;
      return res;
   }

   refresh(): void {
      this._onDidChangeTreeData.fire();
   }

   async add() {
      try {
         // get name
         const input = await vscode.window.showInputBox({ prompt: 'Enter pipeline name.' });
         if (!input) {
            return;
         }

         // replace any spaces with '_' to avoid pathing issues when launching container
         const name = input.replace(/ /g, '_');

         // get path to nextflow storage from settings
         let storagePath = vscode.Uri.file((this.state.getConfigurationPropertyAsString('storagePath', '~/nextflow-sandbox')));

         // prompt user for different path to nextflow storage (if desired)
         let selection = await vscode.window.showInformationMessage('"' + storagePath.path + '" will be used for the pipeline storage path', 'OK', 'Select Different Path' ,'Cancel');
         if (selection === 'Select Different Path') {
            const altStoragePath = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select Storage Path' });
            if (!altStoragePath) {
               return;
            }
            storagePath = altStoragePath[0];
         } else if (selection === 'Cancel') {
            return;
         }

         // make pipeline work root directory (remove existing first if requested)
         const pipelineFolder = storagePath.fsPath + '/' + name;
         if (this.pathExists(pipelineFolder)) {
            let selection = await vscode.window.showWarningMessage('Pipeline "' + name + '" already exists at the specified storage path.  Would you like to replace it?', 'Yes, Replace', 'Cancel');
            if (selection === 'Yes, Replace') {
               try {
                  cp.spawn('rm', ['-r', pipelineFolder]).on('close', () => {
                     this.doAdd(name, storagePath);
                  });
               } catch (err) {
                  vscode.window.showWarningMessage(err.toString());
               }
            } else if (selection === 'Cancel') {
               return;
            }
         } else {
            this.doAdd(name, storagePath);
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   private doAdd(name: string, storagePath: vscode.Uri) {
      try {
         // make pipeline folder (and archive folder)
         const pipelineFolder = storagePath.fsPath + '/' + name;
         const made = mkdirp.sync(pipelineFolder + '/archive');
         if (made === null) {
            vscode.window.showErrorMessage("mkdirp.Made === null (" + pipelineFolder + ")");
            return;
         }

         // make settings.json
         const settings = vscode.Uri.parse('untitled:' + path.join(pipelineFolder, 'settings.json'));
         vscode.workspace.openTextDocument(settings).then(document => {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(settings, new vscode.Position(0, 0), 
'{\n\
   "repository": {\n\
      "url": "",\n\
      "hub": "",\n\
      "tag": ""\n\
    },\n\
    "args": [\n\
    ],\n\
    "options": [\n\
    ],\n\
    "profile": ""\n\
 }');
            vscode.workspace.applyEdit(edit).then(success => {
               if (success) {
                  document.save().then(success => {
                     if (success) {
                        // watch for changes
                        //const watcher = this.watch(document.uri, { recursive: false, excludes: [] });
                     }
                  });
               } else {
                  vscode.window.showErrorMessage("applyEdit failed");
                  return;
               }
            });
         });

         // create new Pipeline object
         let pipeline = new Pipeline(name, storagePath);

         // add new Pipeline object to workspace state
         this.state.addPipeline(pipeline);

         // refresh view
         this.refresh();

         // invoke add event cb
         this.on('added', name);
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   async addConfig(name: string) {
      try {
         let pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            vscode.window.showErrorMessage('Pipeline not found: ' + name);
            return;
         }
         const config = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, openLabel: 'Select Nextflow Config', filters: { 'Nextflow Config': ['config'] } });
         if (config) {
            pipeline.config.push(config[0]);
            this.state.updatePipeline(pipeline);
            this.refresh();
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   async setParams(name: string) {
      try {
         let pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            vscode.window.showErrorMessage('Pipeline not found: ' + name);
            return;
         }
         const params = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, openLabel: 'Select Nextflow Params', filters: { 'Nextflow Params': ['yml', 'yaml', 'json'] } });
         if (params) {
            pipeline.params = params[0];
            this.state.updatePipeline(pipeline);
            this.refresh();
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   async setScript(name: string) {
      try {
         let pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            vscode.window.showErrorMessage('Pipeline not found: ' + name);
            return;
         }
         // get config file
         const script = await vscode.window.showOpenDialog({ canSelectFolders: false, canSelectFiles: true, canSelectMany: false, openLabel: 'Select Nextflow Script', filters: { 'Nextflow Script': ['nf'] } });
         if (script) {
            pipeline.script = script[0];
            this.state.updatePipeline(pipeline);
            this.refresh();
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   async rem(name: string): Promise<boolean> {
      try {
         const pipelineRes = this.nameToResourcesMap[name];
         if (pipelineRes && pipelineRes.nextflow !== undefined) {
            vscode.window.showWarningMessage('Pipeline is running; please stop it before attempting to remove');
            return Promise.resolve(false);
         }
         let selection = await vscode.window.showWarningMessage('Delete "' + name + '" and work folder cache?  Script, parameter, configuration, and other file references will NOT be deleted', 'Yes, Delete', 'Cancel');
         if (selection === 'Yes, Delete') {
            const pipeline = this.state.getPipeline(name);
            if (pipeline) {
               let pipelineFolder = pipeline.storagePath.fsPath + '/' + name;
               const rm = cp.spawnSync('rm', ['-fr', pipelineFolder]);
               if (rm.status === 0) {
                  // hide/dispose output
                  if (pipelineRes) {
                     pipelineRes.outputCh.hide();
                     pipelineRes.outputCh.dispose();
                  }
                  this.state.remPipeline(name);
                  this.refresh();
                  // invoke removed event cb
                  this.on('removed', name);
                  return Promise.resolve(true);
               } else { // failed
                  vscode.window.showWarningMessage('Failed to remove: "' + pipelineFolder + '"');
               }
            } 
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }

      return Promise.resolve(false);
   }

   remDep(dependency: Dependency): boolean {
      try {
         if (!dependency.pipeline) {
            return false;
         }
         const pipelineRes = this.nameToResourcesMap[dependency.pipeline];
         if (pipelineRes && pipelineRes.nextflow !== undefined) {
            vscode.window.showWarningMessage('Pipeline is running; please stop it before attempting to remove dependencies');
            return false;
         }
         let pipeline = this.state.getPipeline(dependency.pipeline);
         if (pipeline) {
            switch (dependency.contextValue) {
               case 'config': 
                  if (dependency.resourceUri) { pipeline.config.splice(pipeline.config.indexOf(dependency.resourceUri), 1); }
                  break;
               case 'option':
                  pipeline.option.splice(pipeline.option.indexOf(dependency.name), 1);
                  break;
               case 'arg':
                  pipeline.arg.splice(pipeline.arg.indexOf(dependency.name), 1);
                  break;
               case 'params':
                  pipeline.params = undefined;
                  break;
               case 'script':
                  pipeline.script = undefined;
                  break;
               default:
                  return false;
            }
            this.state.updatePipeline(pipeline);
            this.refresh();
            return true;
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return false;
   }

   async pull(name: string) {
      try {
         let pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            vscode.window.showErrorMessage('Pipeline not found: ' + name);
            return;
         }

         // parse settings.json
         this.parseSettingsJson(name);

         if (pipeline.repo === undefined) {
            vscode.window.showErrorMessage('Repository must be defined');
            return;
         }

         const pipelineRes = this.pipelineResources(name);
         if (pipelineRes.nextflow !== undefined) {
            return;
         }

         // setup params
         const params = this.setupPullParams(pipeline);

         // get path to nextflow exe from settings
         const nextflowPath = this.state.getConfigurationPropertyAsString('executablePath', 'nextflow');

         // formulate command
         let command = nextflowPath;
         params.forEach(param => {
            command += ' ' + param;
         });
         command += '\r\n';

         // clear/show output
         pipelineRes.outputCh.clear();
         pipelineRes.outputCh.show();

         // output command being executed
         pipelineRes.outputCh.append(command);

         // spawn
         const nf = cp.spawn(nextflowPath, params);

         pipelineRes.nextflow = nf;
         this.refresh();

         // invoke started event cb
         //this.on('started', name);

         // stdout cb
         nf.stdout.on('data', (data) => {
            // invoke updated event cb
            //this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // stderr cb
         nf.stderr.on('data', (data) => {
            // invoke updated event cb
            //this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // close cb
         nf.on('close', async (code) => {
            pipelineRes.nextflow = undefined;
            this.refresh();
            // invoke stopped event cb
            //this.on('stopped', name);
            let selection = (code === 0 ? 
               await vscode.window.showInformationMessage('Nextflow process exited with code: ' + code.toString(), 'OK') :
               await vscode.window.showWarningMessage('Nextflow process exited with code: ' + code.toString()), 'OK');
         });
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   setupPullParams(pipeline: Pipeline): string[] {
      let params: string[] = [];
      try {
         pipeline.option.forEach(option => {
            const tokens = option.split(' ');
            params = params.concat(tokens);
         });
         params.push('pull');
         if (pipeline.repo) {
            params.push(pipeline.repo.url);
            if (pipeline.repo.hub) {
               params.push('-hub');
               params.push(pipeline.repo.hub);
            }
            if (pipeline.repo.tag) {
               params.push('-r');
               params.push(pipeline.repo.tag);
            }
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return params;
   }

   async run(name: string, resume?: boolean | false) {
      try {
         let pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            vscode.window.showErrorMessage('Pipeline not found: ' + name);
            return;
         }

         // parse settings.json
         this.parseSettingsJson(name);

         if (pipeline.script === undefined && pipeline.repo === undefined) {
            vscode.window.showErrorMessage('Script or repository must be defined');
            return;
         }

         const pipelineFolder = path.join(pipeline.storagePath.fsPath, pipeline.name);
         const workFolder = pipelineFolder + '/run';

         // prompt
         /*let selection = await vscode.window.showInformationMessage('"' + name + '" will run with configured options.  Would you like to edit the command-line before executing?', 'Run', 'Edit', 'Cancel');
         if (selection === 'Edit') {
            const edit = await vscode.window.showInputBox({ prompt: 'Edit nextflow command-line', value: command });
            if (!edit) {
               return;
            }
            command = edit.toString();
         } else if (selection === 'Cancel') {
            return;
         }*/

         // check work folder exists if resuming
         if (resume) {
            if (!this.pathExists(workFolder)) {
               vscode.window.showWarningMessage('Pipeline cannot resume');
               return;
            }
         } else { // !resume
            // make run folder (move current run folder to archive first)
            try {
               const runName = this.parseRunName(name);
               if (runName) {
                  const archivePrevRun = this.state.getConfigurationPropertyAsBoolean('archivePreviousRun', true);
                  if (archivePrevRun) {
                     let mv = cp.spawnSync('mv', ['-f', workFolder, path.join(pipelineFolder, 'archive', runName)]);
                     if (mv.status !== 0) {
                        vscode.window.showWarningMessage('Failed to move current run folder to archive');
                     }
                  }
                  else {
                     let rm = cp.spawnSync('rm', ['-fr', workFolder, path.join(pipelineFolder, 'run')]);
                     if (rm.status !== 0) {
                        vscode.window.showWarningMessage('Failed to remove current run folder');
                     }
                  }
               } else { // !runName (couldn't determine run name or no current run)
                  //vscode.window.showWarningMessage();
               }
            } catch (err) {
               vscode.window.showWarningMessage(err.toString());
            }
         }

         this.doRun(name, resume || false, workFolder);
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   async doRun(name: string, resume: boolean, workFolder: string) {
      try {
         const pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            return;
         }
         if (pipeline.script === undefined && pipeline.repo === undefined) {
            return;
         }
         const pipelineFolder = path.join(pipeline.storagePath.fsPath, pipeline.name);

         const pipelineRes = this.pipelineResources(name);
         if (pipelineRes.nextflow !== undefined) {
            return;
         }

         if (!resume && !this.pathExists(workFolder)) {
            const made = mkdirp.sync(workFolder);
            if (made === null) {
               vscode.window.showErrorMessage("mkdirp.Made === null (Failed to create: " + workFolder + ")");
               return;
            }
         }

         // setup params
         const params = this.setupRunParams(pipeline, workFolder, resume);

         // get path to nextflow exe from settings
         const nextflowPath = this.state.getConfigurationPropertyAsString('executablePath', 'nextflow');

         // formulate command
         let command = nextflowPath;
         params.forEach(param => {
            command += ' ' + param;
         });
         command += '\r\n';

         // clear-out last .nextflow.log (to prevent NF from making a backup)
         try {
            fs.writeFileSync(path.join(workFolder, '.nextflow.log'), '');
         } catch (err) {}
         // show .nextflow.log
         //vscode.window.showTextDocument(vscode.Uri.file(path.join(workFolder, '.nextflow.log')));

         // remove last report.htm (to prevent NF from making a backup)
         try {
            cp.spawnSync('rm', [path.join(workFolder, 'report.htm')]);
         } catch (err) {}

         // clear/show output
         pipelineRes.outputCh.clear();
         pipelineRes.outputCh.show();

         // output command being executed
         pipelineRes.outputCh.append(command);

         // get last modified time of work folder to serve as the starting time of this run
         const stats = fs.statSync(workFolder);
         pipeline.mtimeMs = stats.mtimeMs;
         this.state.updatePipeline(pipeline);

         // spawn
         const nf = cp.spawn(nextflowPath, params, { cwd: pipelineFolder });
         pipelineRes.nextflow = nf;
         this.refresh();

         // invoke started event cb
         this.on('started', name);

         // stdout cb
         nf.stdout.on('data', (data) => {
            // invoke updated event cb
            this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // stderr cb
         nf.stderr.on('data', (data) => {
            // invoke updated event cb
            this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // close cb
         nf.on('close', async (code) => {
            pipelineRes.nextflow = undefined;
            this.refresh();
            // invoke stopped event cb
            this.on('stopped', name);
            // show log
            const autoShowLog = this.state.getConfigurationPropertyAsBoolean('autoShowLog', true);
            if (autoShowLog) {
               vscode.window.showTextDocument(vscode.Uri.file(path.join(workFolder, '.nextflow.log')));
            }
            let selection = (code === 0 ? 
               await vscode.window.showInformationMessage('Nextflow process exited with code: ' + code.toString(), 'Open Report') :
               await vscode.window.showWarningMessage('Nextflow process exited with code: ' + code.toString(), 'Open Report'));
            if (selection === 'Open Report') {
               cp.spawn('open', [path.join(workFolder, 'report.htm')]);
            }
         });
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   setupRunParams(pipeline: Pipeline, workFolder: string, resume: boolean) : string[] {
      let params: string[] = [];
      try {
         pipeline.option.forEach(option => {
            const tokens = option.split(' ');
            params = params.concat(tokens);
         });
         params.push('-log');
         params.push(workFolder + '/.nextflow.log');
         params.push('run');
         if (pipeline.repo) {
            params.push(pipeline.repo.url);
            if (pipeline.repo.hub) {
               params.push('-hub');
               params.push(pipeline.repo.hub);
            }
            if (pipeline.repo.tag) {
               params.push('-r');
               params.push(pipeline.repo.tag);
            }
         }
         pipeline.config.forEach(config => {
            params.push('-c');
            params.push(config.path);
         });
         if (pipeline.params) {
            params.push('-params-file');
            params.push(pipeline.params.path);
         }
         if (pipeline.profile) {
            params.push('-profile');
            params.push(pipeline.profile);
         }
         params.push('-w');
         params.push(workFolder);
         params.push('-with-report');
         params.push(workFolder + '/report.htm');
         if (!pipeline.repo && pipeline.script) { // repo trumps script
            params.push(pipeline.script.path);
         }
         if (pipeline.arg.length > 0) {
            params.push('--args=' + pipeline.arg.join(' ').replace(' ', '\xa0'));
         }
         if (resume) {
            params.push('-resume');
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return params;
   }

   stop(name: string) {
      try {
         const pipelineRes = this.nameToResourcesMap[name];
         if (pipelineRes) {
            if (pipelineRes.nextflow === undefined) {
               vscode.window.showWarningMessage('Pipeline not running');
               return;
            }

            pipelineRes.nextflow.kill("SIGINT");
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   config(name: string) {
      try {
         const pipeline = this.state.getPipeline(name);
         if (!pipeline) {
            return;
         }

         // parse settings.json
         this.parseSettingsJson(name);

         if (pipeline.script === undefined && pipeline.repo === undefined) {
            vscode.window.showErrorMessage('Script or repository must be defined');
            return;
         }
         const pipelineFolder = path.join(pipeline.storagePath.fsPath, pipeline.name);

         const pipelineRes = this.pipelineResources(name);
         if (pipelineRes.nextflow !== undefined) {
            return;
         }

         // setup params
         const params = this.setupConfigParams(pipeline);

         // get path to nextflow exe from settings
         const nextflowPath = this.state.getConfigurationPropertyAsString('executablePath', 'nextflow');

         // formulate command
         let command = nextflowPath;
         params.forEach(param => {
            command += ' ' + param;
         });
         command += '\r\n';

         // clear/show output
         pipelineRes.outputCh.clear();
         pipelineRes.outputCh.show();

         // output command being executed
         pipelineRes.outputCh.append(command);

         // spawn
         const nf = cp.spawn(nextflowPath, params, { cwd: pipelineFolder });

         pipelineRes.nextflow = nf;
         this.refresh();

         // invoke started event cb
         //this.on('started', name);

         // stdout cb
         nf.stdout.on('data', (data) => {
            // invoke updated event cb
            //this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // stderr cb
         nf.stderr.on('data', (data) => {
            // invoke updated event cb
            //this.on('updated', name);
            pipelineRes.outputCh.append(data.toString());
         });

         // close cb
         nf.on('close', async (code) => {
            pipelineRes.nextflow = undefined;
            this.refresh();
            // invoke stopped event cb
            //this.on('stopped', name);
            let selection = (code === 0 ? 
               await vscode.window.showInformationMessage('Nextflow process exited with code: ' + code.toString(), 'OK') :
               await vscode.window.showWarningMessage('Nextflow process exited with code: ' + code.toString()), 'OK');
         });
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   setupConfigParams(pipeline: Pipeline): string[] {
      let params: string[] = [];
      try {
         pipeline.option.forEach(option => {
            const tokens = option.split(' ');
            params = params.concat(tokens);
         });
         params.push('config');
         if (pipeline.repo) {
            params.push(pipeline.repo.url);
         }
         pipeline.config.forEach(config => {
            params.push('-c');
            params.push(config.path);
         });
         if (pipeline.profile) {
            params.push('-profile');
            params.push(pipeline.profile);
         }
         if (!pipeline.repo && pipeline.script) { // repo trumps script
            params.push(pipeline.script.path);
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return params;
   }

   moveUp(dependency: Dependency): boolean {
      try {
         if (!dependency.pipeline) {
            return false;
         }
         const pipelineRes = this.nameToResourcesMap[dependency.pipeline];
         if (pipelineRes && pipelineRes.nextflow !== undefined) {
            vscode.window.showWarningMessage('Pipeline is running; please stop it before attempting to move dependencies');
            return false;
         }
         let pipeline = this.state.getPipeline(dependency.pipeline);
         if (pipeline) {
            switch (dependency.contextValue) {
               case 'config': 
                  if (dependency.resourceUri) {
                     const index = pipeline.config.indexOf(dependency.resourceUri);
                     if (index >= 1) {
                        pipeline.config.splice(index-1, 0, pipeline.config.splice(index, 1)[0]);
                     }
                  }
                  break;
               case 'option': // TODO
               case 'arg':
               case 'params':
               default:
                  return false;
            }
            this.state.updatePipeline(pipeline);
            this.refresh();
            return true;
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return false;
   }

   moveDown(dependency: Dependency): boolean {
      try {
         if (!dependency.pipeline) {
            return false;
         }
         const pipelineRes = this.nameToResourcesMap[dependency.pipeline];
         if (pipelineRes && pipelineRes.nextflow !== undefined) {
            vscode.window.showWarningMessage('Pipeline is running; please stop it before attempting to move dependencies');
            return false;
         }
         let pipeline = this.state.getPipeline(dependency.pipeline);
         if (pipeline) {
            switch (dependency.contextValue) {
               case 'config': 
                  if (dependency.resourceUri) {
                     const index = pipeline.config.indexOf(dependency.resourceUri);
                     if (index >= 0 && index < pipeline.config.length-1) {
                        pipeline.config.splice(index+1, 0, pipeline.config.splice(index, 1)[0]);
                     }
                  }
                  break;
               case 'option': // TODO
               case 'arg':
               case 'params':
               default:
                  return false;
            }
            this.state.updatePipeline(pipeline);
            this.refresh();
            return true;
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
      return false;
   }

   getChildren(element?: Dependency): vscode.ProviderResult<Dependency[]> {
      try {
         if (element) {
            let pipeline = this.state.getPipeline(element.name);
            if (pipeline) {
               let children = new Array<Dependency>();
               // settings.json
               const settingsPath = path.join(pipeline.storagePath.fsPath, pipeline.name, 'settings.json');
               children.push(new Dependency('settings.json', undefined, vscode.TreeItemCollapsibleState.None, vscode.Uri.file(settingsPath), { command: 'pipelines.openFile', title: "Open File", arguments: [vscode.Uri.file(settingsPath)] }, element.name));
               // script
               if (pipeline.script) {
                  children.push(new Dependency(path.basename(pipeline.script.path), 'script', vscode.TreeItemCollapsibleState.None, vscode.Uri.file(pipeline.script.path), { command: 'pipelines.openFile', title: "Open File", arguments: [vscode.Uri.file(pipeline.script.path)] }, element.name));
               }
               // config
               pipeline.config.forEach(config => {
                  children.push(new Dependency(path.basename(config.path), 'config', vscode.TreeItemCollapsibleState.None, config, { command: 'pipelines.openFile', title: "Open File", arguments: [vscode.Uri.file(config.path)] }, element.name));
               });
               // params
               if (pipeline.params) {
                  let params = new Dependency(path.basename(pipeline.params.path), 'params', vscode.TreeItemCollapsibleState.None, pipeline.params, { command: 'pipelines.openFile', title: "Open File", arguments: [vscode.Uri.file(pipeline.params.path)] }, element.name);
                  children.push(params);
               }

               return Promise.resolve(children);
            }
         } else {
            let pipelineArr = this.state.getPipelines();
            if (pipelineArr) {
               let children = new Array<Dependency>();
               pipelineArr.forEach(name => {
                  const pipelineRes = this.pipelineResources(name);
                  const contextValue = pipelineRes.nextflow ? 'running' : 'stopped';
                  let dependency = new Dependency(name, contextValue, vscode.TreeItemCollapsibleState.Collapsed);
                  children.push(dependency);
               });

               return Promise.resolve(children);
            }
         }

         return Promise.resolve([]);
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   getTreeItem(element: Dependency): Dependency {
      return element;
   }

   private parseRunName(name: string): string | undefined {
      try {
         const pipeline = this.state.getPipeline(name);
         if (pipeline) {
            try {
               const logPath = path.join(pipeline.storagePath.fsPath, name, 'run', '.nextflow.log');
               const contents = fs.readFileSync(logPath).toString();
               const searchString = 'Run name: ';
               let index = contents.indexOf(searchString, 0);
               if (index >= 0) {
                  const runNameIndex = index + searchString.length;
                  const eolIndex = contents.indexOf('\n', index);
                  return contents.substring(runNameIndex, eolIndex);
               }
            } catch(err) {}
         }
         return undefined;
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   private parseSettingsJson(name: string) {
      try {
         const pipeline = this.state.getPipeline(name);
         if (pipeline) {
            const uri = vscode.Uri.file(path.join(pipeline.storagePath.fsPath, name, 'settings.json'));
            const json = this.getFileAsJson(uri);
            pipeline.arg = json.args || new Array<string>();
            pipeline.option = json.options || new Array<string>();
            pipeline.profile = json.profile;
            let repo = undefined;
            const repository = json.repository;
            if (repository.url) {
               repo = new Repository(repository.url, repository.hub, repository.tag);
            }
            pipeline.repo = repo;
            this.state.updatePipeline(pipeline);
         }
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   /**
    * Try to get a current document as json text.
    */
   private getFileAsJson(file: vscode.Uri): any {
      try {
         const text = fs.readFileSync(file.fsPath).toString();
         if (text.trim().length === 0) {
            return {};
         }
         return JSON.parse(text);
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   private pathExists(path: string): boolean {
      try {
         fs.accessSync(path);
      } catch (err) {
         return false;
      }

      return true;
   }

   /*private watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable | undefined {
      try {
         const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, async (event: string, filename: string | Buffer) => {
            if (event === 'change') {
               const filepath = uri.fsPath;
               const dirname = path.dirname(filepath);
               const name = path.basename(dirname);
               let pipeline = this.state.getPipeline(name);
               if (pipeline) {
                  const json = this.getFileAsJson(uri);
                  pipeline.arg = json.args;
                  pipeline.option = json.options;
                  this.state.updatePipeline(pipeline);
               }
            }
         });

         return { dispose: () => watcher.close() };
      } catch {
      }
   }*/

	/**
	 * Write out the json to a given document.
	 */
	/*private updateTextFile(file: vscode.Uri, json: any) {
		const edit = new vscode.WorkspaceEdit();

		// Just replace the entire document every time for this example extension.
		// A more complete extension should compute minimal edits instead.
		edit.replace(
			document.uri,
			new vscode.Range(0, 0, document.lineCount, 0),
			JSON.stringify(json, null, 2));
		
		return vscode.workspace.applyEdit(edit);
	}*/
}