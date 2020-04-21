import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fe from "./fileExplorer";
import * as pipelines from './pipelines';
import { State } from './state';
import { parentPort } from 'worker_threads';
import { arch } from 'os';
import { ENGINE_METHOD_DIGESTS } from 'constants';
import { fail } from 'assert';

export class Dependency extends vscode.TreeItem {

   public children: Array<Dependency> = new Array<Dependency>();
   public exitcode: number | undefined = undefined;
   private _isRunFolder: boolean | undefined = undefined;
   private _isWorkFolder: boolean | undefined = undefined;
   private _isWorkSubfolder: boolean | undefined = undefined;

   constructor(public name: string,
               public type: vscode.FileType,
               public pipeline: pipelines.Pipeline,
               public resourceUri?: vscode.Uri,
               public description?: string,
               public collapsibleState?: vscode.TreeItemCollapsibleState) {
      super(name, collapsibleState);
   }

   get tooltip(): string | undefined {
      return this.resourceUri?.fsPath;
   }

   isDirectory(): boolean {
      return this.type & vscode.FileType.Directory ? true : false;
   }

   // is run folder (subdirectory of pipeline folder)
   isRunFolder(): boolean {
      if (this._isRunFolder !== undefined) {
         return this._isRunFolder;
      }
      if (this.isDirectory()) {
         for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].isWorkFolder()) {
               this._isRunFolder = true;
               return true;
            }
         }
      }
      return false;
   }

   // is work folder (subdirectory of run folder)
   isWorkFolder(): boolean {
      if (this._isWorkFolder !== undefined) {
         return this._isWorkFolder;
      }
      if (this.isDirectory()) {
         for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].isWorkSubfolder()) {
               this._isWorkFolder = true;
               return true;
            }
         }
      }
      return false;
   }

   // is work sub-folder (subdirectory of work folder)
   isWorkSubfolder(): boolean {
      if (this._isWorkSubfolder !== undefined) {
         return this._isWorkSubfolder;
      }
      if (this.isDirectory()) {
         for (let i = 0; i < this.children.length; i++) {
            if (this.children[i].name === '.command.run') {
               this._isWorkSubfolder = true;
               return true;
            }
         }
      }
      return false;
   }
}

export class PipelineDependency extends Dependency {

   constructor(public name: string,
               public type: vscode.FileType,
               public pipeline: pipelines.Pipeline,
               public resourceUri?: vscode.Uri,
               public description?: string,
               public collapsibleState?: vscode.TreeItemCollapsibleState) {
      super(name, type, pipeline, resourceUri, description, collapsibleState);
   }
}

export class RunsTreeDataProvider implements vscode.TreeDataProvider<Dependency> {

   private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined> = new vscode.EventEmitter<Dependency | undefined>();
   readonly onDidChangeTreeData: vscode.Event<Dependency | undefined> = this._onDidChangeTreeData.event;
   private fileSystemProvider: fe.FileSystemProvider = new fe.FileSystemProvider();
   private refreshName: string | undefined = undefined;
   private nameToDepTreeMap: { [name: string]: Dependency; } = { };
   private decorated: boolean = true;

   constructor(private context: vscode.ExtensionContext,
               private state: State) {
   }

   runStarted(name: string): void {
      this.refresh(name);
   }

   runUpdated(name: string): void {
      this.refresh(name);
   }

   runStopped(name: string): void {
      this.refresh(name);
   }

   refresh(name?: string): void {
      this.refreshName = name;
      this._onDidChangeTreeData.fire();
   }

   toggleDecorated(): void {
      this.decorated = !this.decorated;
      this._onDidChangeTreeData.fire();
   }

   async getChildren(element?: Dependency): Promise<Dependency[]> {
      try {
         if (element) {
            // if run folder, decorate (if decorating)
            if (element.isRunFolder()) { // run folder - decorate if decorating
               const decorated = this.decorated ? this.decorateRunDepTree(element) : element;
               return Promise.resolve(decorated.children);
            // if pipeline, get dependency tree (if necessary)
            } else if (element instanceof PipelineDependency) { // pipeline
               const pipeline = this.state.getPipeline(element.name);
               if (pipeline) {
                  const pipelinePath = path.join(pipeline.storagePath.fsPath, pipeline.name);
                  if (this.pathExists(pipelinePath)) {
                     // get pipeline dependency tree for this pipeline if not already retrieved or if refreshing
                     if (!this.nameToDepTreeMap[pipeline.name] || (this.refreshName === pipeline.name) || (this.refreshName === undefined)) {
                        let pipelineDepTree = new Dependency(path.basename(pipelinePath), vscode.FileType.Directory, pipeline, vscode.Uri.file(pipelinePath));
                        pipelineDepTree.children = await this.getDepTree(pipelinePath, pipeline);
                        const runFolderDep = pipelineDepTree.children.find((value) => { return value.name === 'run'; });
                        if (runFolderDep) {
                           runFolderDep.description = this.getRunName(pipeline) || '';
                        }
                        pipelineDepTree.children.sort((a, b) => {
                           if (a.type === b.type) {
                              return a.name.localeCompare(b.name);
                           }
                           return a.isDirectory() ? -1 : 1;
                        });
                        this.nameToDepTreeMap[pipeline.name] = pipelineDepTree;
                     }
                     return Promise.resolve(this.nameToDepTreeMap[pipeline.name].children);
                  }
               }
            }
            // neither run folder nor pipeline, return children
            return Promise.resolve(element.children); 
         }
         // !element
         let pipelines = new Array<Dependency>();
         const pipelineArr = this.state.getPipelines();
         for (let i = 0; i < pipelineArr.length; i++) {
            const pipeline = this.state.getPipeline(pipelineArr[i]);
            if (pipeline) {
               const pipelinePath = path.join(pipeline.storagePath.fsPath, pipeline.name);
               if (this.pathExists(pipelinePath)) {
                  pipelines.push(new PipelineDependency(path.basename(pipelinePath), vscode.FileType.Directory, pipeline, vscode.Uri.file(pipelinePath)));
               }
            }
         }
         return Promise.resolve(pipelines);
      } catch (err) {}
      return Promise.resolve([]);
   }

   // TODO: simplify (see pipelines' version)
   getTreeItem(element: Dependency): vscode.TreeItem {
      const treeItem = new vscode.TreeItem(element.name, element.collapsibleState || element.type === vscode.FileType.Directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      if (element.type === vscode.FileType.File) {
         treeItem.command = { command: 'runs.showFile', title: "Show File", arguments: [element.resourceUri] };
         treeItem.contextValue = 'file';
      }
      else if (element.type === vscode.FileType.Directory && element.resourceUri !== undefined) {
         treeItem.contextValue = 'directory';
      }
      treeItem.description = element.description;
      treeItem.resourceUri = element.resourceUri;
      treeItem.tooltip = element.resourceUri?.path;
      return treeItem;
   }

   private async getDepTree(fsPath: string, pipeline: pipelines.Pipeline): Promise<Dependency[]> {
      let result = new Array<Dependency>();
      if (this.pathExists(fsPath)) {
         const deps = await this.fileSystemProvider.readDirectory(vscode.Uri.file(fsPath));
         for (let i = 0; i < deps.length; i++) {
            if (deps[i][0] === '.nextflow') { // hide .nextflow folder
               continue;
            }
            const dep = new Dependency(deps[i][0], deps[i][1], pipeline, vscode.Uri.file(path.join(fsPath, deps[i][0])));
            result.push(dep);
            if (dep.type === vscode.FileType.Directory) {
               dep.children = await this.getDepTree(path.join(fsPath, dep.name), pipeline);
            }
         }
      }
      return Promise.resolve(result);
   }

   // this is invoked for each top-level run folder 
   private decorateRunDepTree(root: Dependency): Dependency {
      let decorated = new Dependency(root.name, vscode.FileType.Directory, root.pipeline, root.resourceUri);
      // decorate work folders
      let workFolders = new Array<Dependency>();
      let nonWorkFolders = new Array<Dependency>();
      root.children.forEach(child => {
         if (child.isWorkFolder()) {
            workFolders.push(this.decorateWorkDepTree(child));
         } else {
            // don't include work folders in-waiting (useless info)
            if (!child.isDirectory()) {
               nonWorkFolders.push(child);
            }
         }
      });
      // setup process name aliases for tree view process-folder tree-entries (collapse work subfolders into work folder for ease of access)
      workFolders.forEach(workFolder => {
         workFolder.children.forEach(child => {
            if (child.isWorkSubfolder()) {
               //let collapsed = new Dependency(child.name, vscode.FileType.Directory, child.resourceUri);
               if (workFolder.resourceUri && child.resourceUri) {
                  let collapsed = new Dependency(child.name, vscode.FileType.Directory, child.pipeline, child.resourceUri);
                  collapsed.description = '[' + path.basename(workFolder.resourceUri?.fsPath) + '/' + path.basename(child.resourceUri.fsPath).substr(0, 6) + '] ' + (child.description || '');
                  collapsed.exitcode = child.exitcode;
                  collapsed.children = child.children;
                  decorated.children.push(collapsed);
               }
               //collapsed.children = child.children;
               //decorated.children.push(collapsed);
            } else {
               //let uncollapsed = new Dependency(workFolder.name, vscode.FileType.Directory, workFolder.resourceUri);
               //uncollapsed.children.push(child);
               //decorated.children.push(uncollapsed);
            }
         });
      });
      // group by process name
      decorated.children = this.groupByProcName(decorated.children);
      // concatenate work/nonWork folders
      decorated.children = decorated.children.concat(nonWorkFolders);
      //if (nonWorkFolders.length) {
      //   let uncategorized = new Dependency(".uncategorized", vscode.FileType.Directory, undefined, undefined, vscode.TreeItemCollapsibleState.Collapsed);
      //   uncategorized.children = nonWorkFolders;
      //   decorated.children = decorated.children.concat(uncategorized);
      //}
      // sort
      decorated.children.sort((a, b) => {
         if (a.type === b.type) {
            return a.name.localeCompare(b.name);
         }
         return a.isDirectory() ? -1 : 1;
      });
      return decorated;
   }

   // this is invoked for each top-level work folder
   private decorateWorkDepTree(root: Dependency): Dependency {
      let decorated = new Dependency(root.name, vscode.FileType.Directory, root.pipeline, root.resourceUri);
      root.children.forEach(child => {
         if (child.isWorkSubfolder()) {
            decorated.children.push(this.decorateProcDepTree(child));
         } else {
            decorated.children.push(child);
         }
      });
      return decorated;
   }

   // this is invoked for each process folder (contains the .command.* and .exitcode files)
   private decorateProcDepTree(root: Dependency): Dependency {
      let decorated = new Dependency(root.name, vscode.FileType.Directory, root.pipeline, root.resourceUri);
      //decorated.description = ' ❔';
      root.children.forEach(child => {
         if (child.isDirectory()) {
            decorated.children.push(child);
         } else {
            try {
               if (child.resourceUri) {
                  // get process name from .command.run
                  if (child.resourceUri.fsPath.indexOf('.command.run') !== -1) {
                     const contents = fs.readFileSync(child.resourceUri.fsPath).toString();
                     const searchString = '# NEXTFLOW TASK: ';
                     let index = contents.indexOf(searchString, 0);
                     if (index >= 0) {
                        const procIndex = index + searchString.length;
                        const eolIndex = contents.indexOf('\n', index);
                        const desc = contents.substring(procIndex, eolIndex);
                        decorated.name = desc;
                     }
                  // get process exitcode from .exitcode
                  } else if (child.resourceUri.fsPath.indexOf('.exitcode') !== -1) {
                     const code = fs.readFileSync(child.resourceUri.fsPath);
                     const exitcode = Number(code.toString());
                     if (!isNaN(exitcode)) {
                        //decorated.description = (exitcode === 0 ? ' ✅' : ' ❌');
                        if (exitcode !== 0 &&
                            exitcode !== 143) { // killed by NF
                           decorated.description = '❌';
                        }
                        decorated.exitcode = exitcode;
                     } 
                  }
               }
            } catch (err) {}
            decorated.children.push(child);
         }
      });
      return decorated;
   }

   private groupByProcName(folders: Array<Dependency>): Array<Dependency> {
      let result = new Array<Dependency>();
      let procToDepsMap: Map<string, Array<Dependency>> = new Map<string, Array<Dependency>>();
      folders.forEach(folder => {
         if (folder.name.endsWith(')')) {
            const proc = folder.name.substring(0, folder.name.lastIndexOf('(')-1);
            if (procToDepsMap.get(proc) === undefined) {
               procToDepsMap.set(proc, new Array<Dependency>());
            }
            procToDepsMap.get(proc)?.push(folder);
         } else {
            result.push(folder);
         }
      });
      procToDepsMap.forEach((dependencies: Array<Dependency>, proc: string) => {
         // count number of successes/failures
         let successCount = 0;
         let failureCount = 0;
         dependencies.forEach(dependency => {
            // TODO: refactor!!
            if (dependency.resourceUri) {
               const stats = fs.statSync(dependency.resourceUri.fsPath);
               // only count successes/failures for dependencies in this run (accounts for resume)
               if (dependency.pipeline && stats.mtimeMs >= dependency.pipeline.mtimeMs) {
                  if (dependency.exitcode === 0 ||
                      dependency.exitcode === 143) { // killed by NF
                     successCount++;
                  } else if (dependency.exitcode !== undefined) {
                     failureCount++;
                  }
               //} else {
                  // count previous run dependencies as successes for success logic below
               //   successCount++;
               }
            }
         });
         let description = undefined;
         if (failureCount > 0) {
            description = '❌';
         } else if (successCount === dependencies.length) {
            //description = '✅';
         } else {
            //proc += ' ❔';
         }
         let dependency = new Dependency(proc, vscode.FileType.Directory, dependencies[0].pipeline, undefined, description, vscode.TreeItemCollapsibleState.Expanded); // TODO: does uri need to be set for context menu
         dependency.children = dependencies;
         result.push(dependency);
      });
      return result;
   }

   private getRunName(pipeline: pipelines.Pipeline): string | undefined {
      try {
         const logPath = path.join(pipeline.storagePath.fsPath, pipeline.name, 'run', '.nextflow.log');
         const contents = fs.readFileSync(logPath).toString();
         const searchString = 'Run name: ';
         let index = contents.indexOf(searchString, 0);
         if (index >= 0) {
            const runNameIndex = index + searchString.length;
            const eolIndex = contents.indexOf('\n', index);
            const runName = '[' + contents.substring(runNameIndex, eolIndex) + ']';
            return runName;
         }
      } catch(err) {}
      return undefined;
   }

   openInTerminal(uri: vscode.Uri) {
      const terminal = vscode.window.createTerminal('Nextflow Sandbox');
      let fsPath = uri.fsPath;
      terminal.sendText('cd "' + fsPath + '"');
      terminal.show();
   }

   debug() {
      //vscode.debug.startDebugging();
   }

   private pathExists(path: string): boolean {
      try {
         fs.accessSync(path);
      } catch (err) {
         return false;
      }

      return true;
   }
}