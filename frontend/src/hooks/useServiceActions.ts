import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import {
  launchPersonalOAuth,
  saveRiskCeiling,
  saveServerSelection,
} from '@/services/workspaceService';
import type { ToolRiskLevel } from '@/types';
import { copyText } from '@/utils/clipboard';
import { changeRiskCeiling } from '@/utils/toolRisk';
import { toggleServerSelection } from '@/utils/workspace';
import {
  mutateWorkspace,
  updateWorkspaceServers,
  useWorkspaceSnapshot,
} from '@/hooks/useWorkspaceData';

interface Options {
  // The sign-in popup was blocked; the user needs this link instead.
  onAuthorizationLink?: (name: string, url: string) => void;
}

/**
 * The changes a user can make to one service (turn it on, choose its permission level, sign in),
 * shared by the services list and a service's page. One change at a time per service; the shared
 * store refreshes everything after each.
 */
export const useServiceActions = ({ onAuthorizationLink }: Options = {}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { servers } = useWorkspaceSnapshot();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const withPending = useCallback(async (name: string, run: () => Promise<void>) => {
    setPending((current) => new Set(current).add(name));
    try {
      await mutateWorkspace(run);
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  }, []);

  const toggle = (name: string, selected: boolean) =>
    withPending(name, async () => {
      const saved = await toggleServerSelection(name, selected, {
        save: saveServerSelection,
        update: updateWorkspaceServers,
      });
      if (!saved) showToast(t('workspacePage.toggleFailed', { name }), 'error');
    });

  const changeRisk = (name: string, riskCeiling: ToolRiskLevel) =>
    withPending(name, async () => {
      const server = servers.find((candidate) => candidate.name === name);
      if (!server) return;
      const saved = await changeRiskCeiling(server, riskCeiling, {
        save: saveRiskCeiling,
        update: updateWorkspaceServers,
      });
      if (!saved) showToast(t('workspacePage.risk.changeFailed', { name }), 'error');
    });

  const signIn = (name: string) =>
    withPending(name, async () => {
      try {
        const result = await launchPersonalOAuth(name);
        if (result.kind === 'link') {
          onAuthorizationLink?.(name, result.url);
          showToast(t('workspacePage.popupBlocked'), 'error');
        } else if (result.kind === 'invalid') {
          showToast(t('workspacePage.connectFailed'), 'error');
        }
      } catch (err) {
        showToast(
          t('workspacePage.connectFailed') +
            (err instanceof Error && err.message ? ` (${err.message})` : ''),
          'error',
        );
      }
    });

  const copyEndpoint = async (url: string) => {
    if (await copyText(url)) showToast(t('common.copySuccess'), 'success');
    else showToast(t('common.copyFailed'), 'error');
  };

  return { pending, toggle, changeRisk, signIn, copyEndpoint };
};
