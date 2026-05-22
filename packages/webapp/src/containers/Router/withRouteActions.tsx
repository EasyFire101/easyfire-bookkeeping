import { connect } from 'react-redux';
import { Dispatch } from 'redux';

interface RouteActionsOwnProps {
  location: { pathname: string; search: string };
  history: { push: (loc: { pathname: string; search: string }) => void };
}

export interface WithRouteActionsProps {
  addQuery: (key: string, value: string) => void;
  removeQuery: (key: string) => void;
}

export const mapDispatchToProps = (_dispatch: Dispatch, props: RouteActionsOwnProps): WithRouteActionsProps => {
  return {
    addQuery: (key: string, value: string) => {
      const pathname = props.location.pathname;
      const searchParams = new URLSearchParams(props.location.search);

      searchParams.set(key, value);

      props.history.push({
        pathname: pathname,
        search: searchParams.toString(),
      });
    },

    removeQuery: (key: string) => {
      const pathname = props.location.pathname;
      const searchParams = new URLSearchParams(props.location.search);
      searchParams.delete(key);
      props.history.push({
        pathname: pathname,
        search: searchParams.toString(),
      });
    },
  };
};

export const withRouteActions = connect(null, mapDispatchToProps);
