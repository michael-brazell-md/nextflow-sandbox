import * as vscode from 'vscode';
import * as pipelines from './pipelines';
import * as runs from './runs';
//import * as fe from './fileExplorer';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as cp from 'child_process';
import { runInThisContext } from 'vm';
import { pipeline } from 'stream';
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
         this.pipelinesTreeDataProvider.add();
      });

      this.registerCommand(context, 'pipelines.addConfig', async (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.addConfig(dependency.name);
      });

      this.registerCommand(context, 'pipelines.addOption', async (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.addOption(dependency.name);
      });

      this.registerCommand(context, 'pipelines.addArg', async (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.addArg(dependency.name);
      });

      this.registerCommand(context, 'pipelines.setParams', async (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.setParams(dependency.name);
      });

      this.registerCommand(context, 'pipelines.setScript', async (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.setScript(dependency.name);
      });

      this.registerCommand(context, 'pipelines.refresh', (args: any) => {
         this.pipelinesTreeDataProvider.refresh();
      });

      this.registerCommand(context, 'pipelines.run', (dependency: pipelines.Dependency) => {
         // save modified workspace files before running
         vscode.workspace.saveAll(false).then( onfullfilled => {
            this.pipelinesTreeDataProvider.run(dependency.name);
            this.runsTreeDataProvider.refresh(dependency.name);
         });
      });

      this.registerCommand(context, 'pipelines.resume', (dependency: pipelines.Dependency) => {
         // save modified workspace files before running
         vscode.workspace.saveAll(false).then( onfullfilled => {
            this.pipelinesTreeDataProvider.run(dependency.name, true);
            this.runsTreeDataProvider.refresh(dependency.name);
         });
      });

      this.registerCommand(context, 'pipelines.stop', (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.stop(dependency.name);
         this.runsTreeDataProvider.refresh(dependency.name);
      });

      this.registerCommand(context, 'pipelines.config', (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.config(dependency.name);
         this.runsTreeDataProvider.refresh(dependency.name);
      });

      this.registerCommand(context, 'pipelines.remove', async (dependency: pipelines.Dependency) => {
         const removed = await this.pipelinesTreeDataProvider.rem(dependency.name);
         if (removed) {
         }
      });

      this.registerCommand(context, 'pipelines.removeDep', (dependency: pipelines.Dependency) => {
         const removed = this.pipelinesTreeDataProvider.remDep(dependency);
      });

      this.registerCommand(context, 'pipelines.moveConfigUp', (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.moveUp(dependency);
      });

      this.registerCommand(context, 'pipelines.moveConfigDown', (dependency: pipelines.Dependency) => {
         this.pipelinesTreeDataProvider.moveDown(dependency);
      });

      this.registerCommand(context, 'pipelines.openFile', (resource: vscode.Uri) => {
         vscode.window.showTextDocument(resource);
      });

      // runs
      this.registerCommand(context, 'runs.showFile', (resource: vscode.Uri, resources: Array<vscode.Uri>) => {
         vscode.window.showTextDocument(resource); // TODO: multi
      });

      this.registerCommand(context, 'runs.openFile', (resource: runs.Dependency, resources: Array<vscode.Uri>) => {
         if (resource.resourceUri) {
            cp.spawn('open', [resource.resourceUri.fsPath]); // TODO: multi
         }
      });

      this.registerCommand(context, 'runs.revealInFinder', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         if (resource.resourceUri) {
            cp.spawn('open', [resource.resourceUri.path]); // TODO: multi
         }
      });

      this.registerCommand(context, 'runs.openInTerminal', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         if (resource.resourceUri) {
            this.runsTreeDataProvider.openInTerminal(resource.resourceUri);
         }
      });

      this.registerCommand(context, 'runs.delete', (resource: runs.Dependency, resources: Array<runs.Dependency>) => {
         try {
            if (resources) {
               for (let i = 0; i < resources.length; i++) {
                  const resourceI = resources[i];
                  if (resourceI.resourceUri) {
                     cp.spawn('rm', ['-r', resourceI.resourceUri.path]).on('close', () => {
                        this.runsTreeDataProvider.refresh();
                     });
                  }
               }
            } else if (resource.resourceUri) {
               cp.spawn('rm', ['-r', resource.resourceUri.path]).on('close', () => {
                  this.runsTreeDataProvider.refresh();
               });
            }
         } catch (err) {}
      });

      this.registerCommand(context, 'runs.refresh', (args: any) => {
         this.runsTreeDataProvider.refresh();
      });

      this.registerCommand(context, 'runs.toggleDecorated', (args: any) => {
         this.runsTreeDataProvider.toggleDecorated();
      });

      this.registerCommand(context, 'runs.launchContainer', (resource: runs.Dependency) => {
         if (resource.resourceUri) {
            this.runsTreeDataProvider.launchContainer(resource.resourceUri);
         }
      });
   }
   
   private registerCommand(context: vscode.ExtensionContext, command: string, callback: (...args: any[]) => any, thisArg?: any) {
      let disposable = vscode.commands.registerCommand(command, callback);
      context.subscriptions.push(disposable);
   }

   private onDidChangePipelinesSelection(selection: pipelines.Dependency[]) {
      if (selection[0].contextValue === 'pipeline') {
      }
   }

   private onDidChangeRunsSelection(selection: any[])  {
      // TODO
   }
}