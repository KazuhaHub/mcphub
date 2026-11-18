import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyBlock } from '@/components/ui/CopyBlock';
import { EndpointCopy } from '@/components/ui/EndpointCopy';
import { getSmartRoutingPath } from '@/utils/runtime';
import {
  WORKSPACE_SNIPPET_CLIENTS,
  buildSmartEndpoint,
  buildWorkspaceSnippets,
} from '@/utils/workspace';
import type { ClientSnippetId } from '@/utils/mcpClientSnippets';

interface MyEndpointCardProps {
  aggregate: string;
  smartRoutingEnabled: boolean;
}

const SNIPPET_LABEL_KEYS: Partial<Record<ClientSnippetId, string>> = {
  'generic-mcp-servers': 'workspacePage.endpoint.clientGeneric',
  'claude-code': 'workspacePage.endpoint.clientClaude',
  cursor: 'workspacePage.endpoint.clientCursor',
};

const MyEndpointCard: React.FC<MyEndpointCardProps> = ({ aggregate, smartRoutingEnabled }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'direct' | 'smart'>('direct');
  const [clientId, setClientId] = useState<ClientSnippetId>('generic-mcp-servers');

  const smartUrl = useMemo(() => buildSmartEndpoint(aggregate, getSmartRoutingPath()), [aggregate]);
  const activeUrl = mode === 'smart' ? smartUrl : aggregate;
  const blocks = useMemo(() => buildWorkspaceSnippets(clientId, activeUrl), [clientId, activeUrl]);

  return (
    <section className="hub-card p-4 space-y-4" aria-labelledby="workspace-endpoint-title">
      <div>
        <h2 id="workspace-endpoint-title" className="hub-card-title">
          {t('workspacePage.endpoint.title')}
        </h2>
        <p className="hub-sub mt-1">{t('workspacePage.endpoint.description')}</p>
      </div>

      <EndpointCopy
        url={aggregate}
        label={t('workspacePage.endpoint.direct')}
        ariaLabel={t('workspacePage.endpoint.direct')}
      />
      <EndpointCopy
        url={smartUrl}
        label={t('workspacePage.endpoint.smart')}
        ariaLabel={t('workspacePage.endpoint.smart')}
      />
      <p className="text-[12px] leading-[1.625]" style={{ color: 'var(--hub-ink-3)' }}>
        {t('workspacePage.endpoint.smartHint')}
        {!smartRoutingEnabled && <> {t('workspacePage.endpoint.smartDisabled')}</>}
      </p>

      <div className="space-y-3 border-t border-[var(--hub-line-2)] pt-4">
        <h3 className="text-[14px] font-semibold">{t('workspacePage.endpoint.snippets')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="hub-seg" role="group" aria-label={t('workspacePage.endpoint.mode')}>
            {(['direct', 'smart'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {t(`workspacePage.endpoint.mode_${value}`)}
              </button>
            ))}
          </div>
          <div className="hub-seg" role="tablist" aria-label={t('workspacePage.endpoint.client')}>
            {WORKSPACE_SNIPPET_CLIENTS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={clientId === id}
                onClick={() => setClientId(id)}
              >
                {t(SNIPPET_LABEL_KEYS[id] ?? id)}
              </button>
            ))}
          </div>
        </div>
        {blocks.map((block, index) => (
          <CopyBlock key={`${clientId}-${index}`} text={block.text} />
        ))}
        <p className="text-[12px] leading-[1.625]" style={{ color: 'var(--hub-ink-3)' }}>
          {t('workspacePage.endpoint.authNote')}
        </p>
      </div>
    </section>
  );
};

export default MyEndpointCard;
