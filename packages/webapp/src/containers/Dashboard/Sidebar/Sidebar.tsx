// @ts-nocheck
import React from 'react';
import { SidebarOverlayBinded } from '../SidebarOverlay';
import { useMainSidebarMenu } from './hooks';
import { SidebarContainer } from './SidebarContainer';
import { SidebarHead } from './SidebarHead';
import { SidebarMenu } from './SidebarMenu';
import { EASYFIRE_SOURCE_URL } from '@/constants/legal';

import '@/style/containers/Dashboard/Sidebar.scss';

/**
 * Dashboard sidebar.
 * @returns {JSX.Element}
 */
export function Sidebar() {
  const menu = useMainSidebarMenu();

  return (
    <SidebarContainer>
      <SidebarHead />

      <div className="sidebar__menu">
        <SidebarMenu menu={menu} />
      </div>
      <SidebarOverlayBinded />
      <SidebarFooterVersion />
    </SidebarContainer>
  );
}

/**
 * Sidebar footer version.
 * @returns {React.JSX}
 */
function SidebarFooterVersion() {
  const { REACT_APP_VERSION } = process.env;

  return (
    <div className="sidebar__version">
      {REACT_APP_VERSION && <span>v{REACT_APP_VERSION}</span>}
      <a href={EASYFIRE_SOURCE_URL} target="_blank" rel="noopener noreferrer">
        Source code (AGPL-3.0)
      </a>
    </div>
  );
}
