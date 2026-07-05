// @ts-nocheck
import { isEmpty } from 'lodash';
import React from 'react';
import { useProjects } from '../../hooks';
import { DashboardInsider } from '@/components';
import { useResourceViews, useResourceMeta } from '@/hooks/query';

const ProjectsListContext = React.createContext();

/**
 * Projects list data provider.
 * @returns
 */
function ProjectsListProvider({ query, tableStateChanged, ...props }) {
  // Fetch accounts resource views and fields.
  const { data: projectsViews, isLoading: isViewsLoading } =
    useResourceViews('projects');

  // Fetch accounts list according to the given custom view id.
  const {
    data: projectsData,
    isFetching: isProjectsFetching,
    isLoading: isProjectsLoading,
  } = useProjects(query, { keepPreviousData: true });

  // Detarmines the datatable empty status.
  const isEmptyStatus =
    isEmpty(projectsData?.data) && !tableStateChanged && !isProjectsLoading;

  // provider payload.
  const provider = {
    projects: projectsData?.data,

    projectsViews,

    isProjectsLoading,
    isProjectsFetching,
    isViewsLoading,

    isEmptyStatus,
  };

  return (
    <DashboardInsider loading={isViewsLoading} name={'projects'}>
      <ProjectsListContext.Provider value={provider} {...props} />
    </DashboardInsider>
  );
}

const useProjectsListContext = () => React.useContext(ProjectsListContext);

export { ProjectsListProvider, useProjectsListContext };
