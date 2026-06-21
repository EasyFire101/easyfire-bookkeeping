import { SET_ORGANIZATION_CONGRATS } from '@/store/types';
import type { RootState } from '@/store/reducers';

export const setOrganizationSetupCompleted =
  (congrats: boolean) => (dispatch: any, getState: () => RootState) => {
    const organizationId = getState().authentication.organizationId as string;

    dispatch({
      type: SET_ORGANIZATION_CONGRATS,
      payload: { organizationId, congrats },
    });
  };
