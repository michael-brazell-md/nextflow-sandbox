import * as vscode from 'vscode';
import * as pipelines from './pipelines';
import * as runs from './runs';
//import * as fe from './fileExplorer';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as cp from 'child_process';
import { runInThisContext } from 'vm';
import { pipeline, PassThrough } from 'stream';
import { State } from './state';

export class NfSandbox {

   private pipelinesViewer: vscode.TreeView<any>;
   private pipelinesTreeDataProvider: pipelines.PipelinesTreeDataProvider;
   private runsViewer: vscode.TreeView<any>;
   private runsTreeDataProvider: runs.RunsTreeDataProvider;
   private state: State;

   constructor(private context: vscode.ExtensionContext) {
      this.state = new State(context);

      // pipelines view
      this.pipelinesTreeDataProvider = new pipelines.PipelinesTreeDataProvider(context, this.state,
         (event: string, pipeline: string) => {
            switch(event) {
               case 'started':
               case 'updated':
               case 'stopped':
               case 'added':
                  this.runsTreeDataProvider.refresh(pipeline);
                  break;
               case 'removed':
                  this.runsTreeDataProvider.refresh();
                  break;
               default:
                  break;
            }
      });
      this.pipelinesViewer = vscode.window.createTreeView('pipelines', { treeDataProvider : this.pipelinesTreeDataProvider });

      this.pipelinesViewer.onDidChangeSelection(e => {
         this.onDidChangePipelinesSelection(e.selection);
      });

      // runs view
      this.runsTreeDataProvider = new runs.RunsTreeDataProvider(context, this.state);
      this.runsViewer = vscode.window.createTreeView('runs', { treeDataProvider : this.runsTreeDataProvider, canSelectMany: true });

      this.runsViewer.onDidChangeSelection(e => {
         this.onDidChangeRunsSelection(e.selection);
      });

      // register commands
      this.registerCommands(context);
   }

   private registerCommands(context: vscode.ExtensionContext) {
      // pipelines 
      this.registerCommand(context, 'pipelines.add', async () => {
         try {
            this.pipelinesTreeDataProvider.add();
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.addConfig', async (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.addConfig(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.setParams', async (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.setParams(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.setScript', async (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.setScript(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.refresh', (args: any) => {
         try {
            this.pipelinesTreeDataProvider.refresh();
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.run', (dependency: pipelines.Dependency) => {
         try {
            // save modified workspace files before running
            vscode.workspace.saveAll(false).then( onfullfilled => {
               this.pipelinesTreeDataProvider.run(dependency.name);
               this.runsTreeDataProvider.refresh(dependency.name);
            });
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.resume', (dependency: pipelines.Dependency) => {
         try {
            // save modified workspace files before running
            vscode.workspace.saveAll(false).then( onfullfilled => {
               this.pipelinesTreeDataProvider.run(dependency.name, true);
               this.runsTreeDataProvider.refresh(dependency.name);
            });
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.stop', (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.stop(dependency.name);
            this.runsTreeDataProvider.refresh(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.config', (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.config(dependency.name);
            this.runsTreeDataProvider.refresh(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.pull', (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.pull(dependency.name);
            this.runsTreeDataProvider.refresh(dependency.name);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.remove', async (dependency: pipelines.Dependency) => {
         try {
            const removed = await this.pipelinesTreeDataProvider.rem(dependency.name);
            if (removed) {
            }
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.removeDep', (dependency: pipelines.Dependency) => {
         try {
            const removed = this.pipelinesTreeDataProvider.remDep(dependency);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.moveConfigUp', (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.moveUp(dependency);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.moveConfigDown', (dependency: pipelines.Dependency) => {
         try {
            this.pipelinesTreeDataProvider.moveDown(dependency);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'pipelines.openFile', (resource: vscode.Uri) => {
         try {
            vscode.window.showTextDocument(resource);
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      // runs
      this.registerCommand(context, 'runs.showFile', (resource: vscode.Uri, resources: Array<vscode.Uri>) => {
         try {
            vscode.window.showTextDocument(resource); // TODO: multi
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.openFile', (resource: runs.Dependency, resources: Array<vscode.Uri>) => {
         try {
            if (resource.resourceUri) {
               cp.spawn('open', [resource.resourceUri.fsPath]); // TODO: multi
            }
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.revealInFinder', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         try {
            if (resource.resourceUri) {
               cp.spawn('open', [resource.resourceUri.path]); // TODO: multi
            }
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.openInTerminal', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         try {
            if (resource.resourceUri) {
               this.runsTreeDataProvider.openInTerminal(resource.resourceUri);
            }
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.delete', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         try {
            let options = new Array<string>('-r');
            if (resources) {
               for (let i = 0; i < resources.length; i++) {
                  const resourceI = resources[i];
                  if (resourceI.resourceUri) {
                     options = options.concat(resourceI.resourceUri.fsPath);
                  }
               }
            } else if (resource.resourceUri) {
               options = options.concat(resource.resourceUri.fsPath);
            }
            cp.spawn('rm', options).on('close', () => {
               this.runsTreeDataProvider.refresh();
            });
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.refresh', (args: any) => {
         try {
            this.runsTreeDataProvider.refresh();
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.toggleDecorated', (args: any) => {
         try {
            this.runsTreeDataProvider.toggleDecorated();
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });

      this.registerCommand(context, 'runs.launchContainer', (resource: runs.Dependency) => {
         try {
            if (resource.resourceUri) {
               this.runsTreeDataProvider.launchContainer(resource.resourceUri);
            }
         } catch (err) {
            vscode.window.showErrorMessage(err.toString());
         }
      });
   }
   
   private registerCommand(context: vscode.ExtensionContext, command: string, callback: (...args: any[]) => any, thisArg?: any) {
      try {
         let disposable = vscode.commands.registerCommand(command, callback);
         context.subscriptions.push(disposable);
      } catch (err) {
         vscode.window.showErrorMessage(err.toString());
      }
   }

   private onDidChangePipelinesSelection(selection: pipelines.Dependency[]) {
      if (selection[0].contextValue === 'pipeline') {
      }
   }

   private onDidChangeRunsSelection(selection: any[])  {
      // TODO
   }
}