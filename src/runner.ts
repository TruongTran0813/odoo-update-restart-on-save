import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";

interface IConfig {
  pythonPath: string;
  binPath: string;
  configPath: string;
  databaseName: string;
  addons: string[];
  modules: string[];
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

  private runInNewTerminal(moduleName: string) {
    const cmd = `${this.config.pythonPath} ${this.config.binPath} -c ${this.config.configPath} -d ${this.config.databaseName} -u ${moduleName} --stop-after-init`;

    let child = exec(cmd);
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

  public async loadConfig(): Promise<void> {
    const config = this.context.globalState.get(
      "odoo-update-restart-on-save.configurations"
    ) as any;
    let modules: string[] = [];
    for (const addonsPath of config.addons) {
      const directoryUri = vscode.Uri.file(addonsPath);

      const children = await vscode.workspace.fs.readDirectory(directoryUri);
      modules = modules.concat(
        children
          .filter(([name, type]) => type === vscode.FileType.Directory)
          .map(([name, type]) => name)
      );
    }
    this.config = {
      addons: config.addons,
      binPath: path.join(config.odooPath, "odoo-bin"),
      configPath: path.join(config.odooPath, "odoo.conf"),
      databaseName: config.name,
      pythonPath: config.pythonPath,
      modules: modules,
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
    const root = vscode.workspace.rootPath;
    const relativeFile = "." + document.fileName.replace(root || "", "");

    const moduleName = this.config.modules.find((module) =>
      relativeFile.includes(module)
    );
    const extName = path.extname(document.fileName);
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

    if (isXmlJsCss && moduleName) {
      this.runInNewTerminal(moduleName);
    } else vscode.commands.executeCommand("workbench.action.debug.restart");
  }
  public async updateModule(uri: vscode.Uri): Promise<void> {
    const filePath = uri.fsPath;
    const folderName = path.basename(filePath);
    const moduleName = this.config.modules.find(
      (module) => module === folderName
    );
    const valuesToCheck = [
      this.config.pythonPath,
      this.config.binPath,
      this.config.configPath,
      this.config.databaseName,
    ];
    if (!moduleName || valuesToCheck.some((value) => !value)) {
      this.showOutputMessage();
      return;
    }
    this.runInNewTerminal(moduleName);
  }
}
