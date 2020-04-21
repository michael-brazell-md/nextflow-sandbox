import * as vscode from 'vscode';
import * as pipelines from './pipelines';
import * as runs from './runs';

//namespace nftr {

export class State {

   public workspaceConfig: vscode.WorkspaceConfiguration;

   constructor(private context: vscode.ExtensionContext) {
      this.workspaceConfig = vscode.workspace.getConfiguration('nextflow-sandbox');
   }

   // pipelines
   getPipelines(): Array<string> {
      return this.context.workspaceState.get('Pipelines') as Array<string> || new Array<string>();
   }

   addPipeline(pipeline: pipelines.Pipeline) {
      let pipelineArr = this.getPipelines();
      if (!pipelineArr.find(n => n === pipeline.name)) {
         pipelineArr.push(pipeline.name);
         this.context.workspaceState.update('Pipelines', pipelineArr);
      }
      this.updatePipeline(pipeline);
   }

   remPipeline(name: string): boolean {
      let pipelineArr = this.getPipelines();
      let pipeline = pipelineArr.find(n => n === name);
      if (pipeline) {
         pipelineArr.splice(pipelineArr.indexOf(pipeline), 1);
         this.context.workspaceState.update('Pipelines', pipelineArr);
         this.context.workspaceState.update(name, undefined);
         return true;
      }
      return false; // not found
   }

   getPipeline(name?: string): pipelines.Pipeline | undefined {
      if (name) {
         return this.context.workspaceState.get(name);
      }
      return undefined;
   }

   updatePipeline(pipeline: pipelines.Pipeline) {
      this.context.workspaceState.update(pipeline.name, pipeline);
   }

   getConfigurationPropertyAsString(name: string, defaultValue: string): string {
      let value = defaultValue;
      const property = this.workspaceConfig.inspect(name);
      if (property) {
         const propertyValue = property.globalValue as string;
         if (propertyValue !== undefined) {
            value = propertyValue;
         }
      }
      return value;
   }

   getConfigurationPropertyAsBoolean(name: string, defaultValue: boolean): boolean {
      let value = defaultValue;
      const property = this.workspaceConfig.inspect(name);
      if (property) {
         const propertyValue = property.globalValue as boolean;
         if (propertyValue !== undefined) {
            value = propertyValue;
         }
      }
      return value;
   }
}

//}