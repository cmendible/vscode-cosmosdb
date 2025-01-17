/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from '@azure/arm-postgresql/src/models';
import * as vscode from 'vscode';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { setPostgresCredentials } from '../../setPostgresCredentials';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerSetCredentialsStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 200;

    public async execute(wizardContext: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const user: string = nonNullProp(wizardContext, 'longUserName');
        const newServerName: string = nonNullProp(wizardContext, 'newServerName');

        const setupMessage: string = localize('setupCredentialsMessage', 'Setting up Credentials for server "{0}"...', newServerName);
        progress.report({ message: setupMessage });
        ext.outputChannel.appendLog(setupMessage);
        const password: string = nonNullProp(wizardContext, 'adminPassword');
        const server: Server = nonNullProp(wizardContext, 'server');

        await setPostgresCredentials(user, password, nonNullProp(server, 'id'));
        const completedMessage: string = localize('addedCredentialsMessage', 'Successfully setup credentials for server "{0}".', newServerName);
        void vscode.window.showInformationMessage(completedMessage);
        ext.outputChannel.appendLog(completedMessage);
    }

    public shouldExecute(): boolean {
        return true;
    }
}
