/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from '@azure/arm-postgresql';
import { FirewallRule } from '@azure/arm-postgresql/src/models';
import * as vscode from 'vscode';
import { Progress } from 'vscode';
import { AzureWizardExecuteStep, createAzureClient } from 'vscode-azureextensionui';
import { ext } from '../../../../extensionVariables';
import { localize } from '../../../../utils/localize';
import { nonNullProp } from '../../../../utils/nonNull';
import { IPostgresServerWizardContext } from '../IPostgresServerWizardContext';

export class PostgresServerSetFirewallStep extends AzureWizardExecuteStep<IPostgresServerWizardContext> {
    public priority: number = 250;

    public async execute(wizardContext: IPostgresServerWizardContext, progress: Progress<{ message?: string; increment?: number }>): Promise<void> {

        const ip: string = nonNullProp(wizardContext, 'publicIp');
        const client: PostgreSQLManagementClient = createAzureClient(wizardContext, PostgreSQLManagementClient);
        const resourceGroup: string = nonNullProp(nonNullProp(wizardContext, 'resourceGroup'), 'name');
        const newServerName: string = nonNullProp(wizardContext, 'newServerName');
        const firewallRuleName: string = "azureDatabasesForVSCode-publicIp";

        const newFirewallRule: FirewallRule = {
            startIpAddress: ip,
            endIpAddress: ip
        };

        const addFirewallMessage: string = localize('configuringFirewall', 'Adding firewall rule for your IP "{0}" to server "{1}"...', ip, newServerName);
        progress.report({ message: addFirewallMessage });
        ext.outputChannel.appendLog(addFirewallMessage);
        await client.firewallRules.createOrUpdate(resourceGroup, newServerName, firewallRuleName, newFirewallRule);

        const completedMessage: string = localize('addedFirewallRule', 'Successfully added firewall rule for IP "{0}" to server "{1}".', ip, newServerName);
        void vscode.window.showInformationMessage(completedMessage);
        ext.outputChannel.appendLog(completedMessage);
    }

    public shouldExecute(wizardContext: IPostgresServerWizardContext): boolean {
        return !!wizardContext.addFirewall;
    }
}
