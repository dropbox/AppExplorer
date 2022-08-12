import React from "react";
import { Route } from "react-router";

const LazyComponent = React.lazy(() => import("./lazy-component"));

export default function Lazy() {
  return (
    <div>
      <Route component={LazyComponent} />
    </div>
  );
}
