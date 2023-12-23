import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
var ncp = require("copy-paste");
var endOfLine = require("os").EOL;

interface IConfig {
  pythonPath: string;
  binPath: string;
  configPath: string;
  databaseName: string;
  addons: string[];
}

export class RunOnSaveExtExtension {
  private outputChannel: vscode.OutputChannel;
  private context: vscode.ExtensionContext;
  private config: IConfig;
  private isRunning: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.isRunning = false;
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel("Run On Save Ext");
    this.config = <IConfig>(
      (<any>vscode.workspace.getConfiguration("odooUpdateRestartOnSave"))
    );
  }

  private runInNewTerminal(command: string, moduleName?: string) {
    let child = exec(command);
    const msg = "Updating Odoo module: " + moduleName + "...";
    this.showStatusMessage(msg);

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: msg,
        //cancellable: true,
      },
      (progress, token) => {
        token.onCancellationRequested(() => {
          console.log("User canceled the long running operation");
        });

        child.stdout?.on("data", (data) => {
          console.log(`stdout: ${data}`);
        });

        child.stderr?.on("data", (data) => {
          console.error(`stderr: ${data}`);
        });

        child.on("close", (code) => {
          console.log(`child process exited with code ${code}`);
          progress.report({
            increment: 100,
            message: "Odoo module: " + moduleName + " updated!",
          });
          this.showStatusMessage("Odoo module: " + moduleName + " updated!");
        });

        return new Promise((resolve, reject) => {
          child.on("exit", resolve);
          child.on("error", reject);
        });
      }
    );
  }

  public loadConfig(): void {
    const config = this.context.globalState.get(
      "odoo-update-restart-on-save.configurations"
    ) as any;
    this.config = {
      addons: config.addons,
      binPath: path.join(config.odooPath, "odoo-bin"),
      configPath: path.join(config.odooPath, "odoo.conf"),
      databaseName: config.name,
      pythonPath: config.pythonPath,
    };
  }

  public showOutputMessage(message?: string): void {
    this.outputChannel.appendLine(message || "");
  }

  public showStatusMessage(message: string): vscode.Disposable {
    this.showOutputMessage(message);
    return vscode.window.setStatusBarMessage(message);
  }

  public async runCommands(document: vscode.TextDocument): Promise<void> {
    this.showStatusMessage("Running on save commands...");
    // build our commands by replacing parameters with values
    var root = vscode.workspace.rootPath;
    var relativeFile = "." + document.fileName.replace(root || "", "");
    let modules: string[] = [];
    for (const addonsPath of this.config.addons) {
      const directoryUri = vscode.Uri.file(addonsPath);

      const children = await vscode.workspace.fs.readDirectory(directoryUri);
      modules = modules.concat(
        children
          .filter(([name, type]) => type === vscode.FileType.Directory)
          .map(([name, type]) => name)
      );
    }
    var moduleName = modules.find((module) => relativeFile.includes(module));
    var extName = path.extname(document.fileName);
    const isXmlJsCss = [".xml", ".js", ".css"].includes(extName);
    const isPyCsv = [".py", ".csv"].includes(extName);
    const valuesToCheck = [
      moduleName,
      this.config.pythonPath,
      this.config.binPath,
      this.config.configPath,
      this.config.databaseName,
    ];
    if (valuesToCheck.some((value) => !value) || (!isXmlJsCss && !isPyCsv)) {
      this.showOutputMessage();
      return;
    }

    if (isXmlJsCss) {
      const cmd = `${this.config.pythonPath} ${this.config.binPath} -c ${this.config.configPath} -d ${this.config.databaseName} -u ${moduleName} --stop-after-init`;
      this.runInNewTerminal(cmd, moduleName);
    } else vscode.commands.executeCommand("workbench.action.debug.restart");
  }
}
