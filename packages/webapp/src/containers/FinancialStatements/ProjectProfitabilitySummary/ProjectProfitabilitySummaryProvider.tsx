import React, { createContext, useMemo, useContext, ReactNode } from 'react';

import { FinancialReportPage } from '../FinancialReportPage';
import { useProjectProfitabilitySummary } from './hooks';
import { useProjects } from '@/containers/Projects/hooks';
import { transformFilterFormToQuery } from '../common';

type UseProjectProfitabilitySummaryResult = ReturnType<typeof useProjectProfitabilitySummary>;

interface ProjectProfitabilitySummaryContextValue {
  projectProfitabilitySummary: UseProjectProfitabilitySummaryResult['data'];
  isProjectProfitabilitySummaryFetching: boolean;
  isProjectProfitabilitySummaryLoading: boolean;
  refetchProjectProfitabilitySummary: UseProjectProfitabilitySummaryResult['refetch'];
  projects: any;
  query: Record<string, unknown>;
  filter: Record<string, unknown>;
}

interface ProjectProfitabilitySummaryProviderProps {
  filter: Record<string, unknown>;
  children?: ReactNode;
}

const ProjectProfitabilitySummaryContext = createContext<ProjectProfitabilitySummaryContextValue | undefined>(undefined);

function ProjectProfitabilitySummaryProvider({ filter, ...props }: ProjectProfitabilitySummaryProviderProps) {
  // Transformes the given filter to query.
  const query = useMemo(() => transformFilterFormToQuery(filter), [filter]);

  // Handle fetching the items table based on the given query.
  const {
    data: projectProfitabilitySummary,
    isFetching: isProjectProfitabilitySummaryFetching,
    isLoading: isProjectProfitabilitySummaryLoading,
    refetch: refetchProjectProfitabilitySummary,
  } = useProjectProfitabilitySummary(query, { placeholderData: (prev: any) => prev });

  // Fetch project list.
  const {
    data: projectsData,
    isLoading: isProjectsLoading,
  } = useProjects();

  const provider: ProjectProfitabilitySummaryContextValue = {
    projectProfitabilitySummary,
    isProjectProfitabilitySummaryFetching,
    isProjectProfitabilitySummaryLoading,
    refetchProjectProfitabilitySummary,
    projects: projectsData?.projects,

    query,
    filter,
  };
  return (
    <FinancialReportPage name={'project-profitability-summary'}>
      <ProjectProfitabilitySummaryContext.Provider
        value={provider}
        {...props}
      />
    </FinancialReportPage>
  );
}

const useProjectProfitabilitySummaryContext = (): ProjectProfitabilitySummaryContextValue => {
  const ctx = useContext(ProjectProfitabilitySummaryContext);
  if (!ctx) throw new Error('useProjectProfitabilitySummaryContext must be used within a ProjectProfitabilitySummaryProvider');
  return ctx;
};

export {
  ProjectProfitabilitySummaryProvider,
  useProjectProfitabilitySummaryContext,
};
