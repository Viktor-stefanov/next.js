import type { RouteHandlerManagerContext } from '../future/route-handler-managers/route-handler-manager'
import type { RouteDefinition } from '../future/route-definitions/route-definition'
import type { RouteModule } from '../future/route-modules/route-module'
import type { NextRequest } from './spec-extension/request'

import { adapter, enhanceGlobals, type AdapterOptions } from './adapter'
import { IncrementalCache } from '../lib/incremental-cache'
enhanceGlobals()

import { removeTrailingSlash } from '../../shared/lib/router/utils/remove-trailing-slash'
import { RouteMatcher } from '../future/route-matchers/route-matcher'
import { ManifestLoader } from '../future/route-modules/pages/helpers/load-manifests'

type WrapOptions = Partial<Pick<AdapterOptions, 'page'>>

/**
 * EdgeRouteModuleWrapper is a wrapper around a route module.
 *
 * Note that this class should only be used in the edge runtime.
 */
export class EdgeRouteModuleWrapper {
  private readonly matcher: RouteMatcher

  /**
   * The constructor is wrapped with private to ensure that it can only be
   * constructed by the static wrap method.
   *
   * @param routeModule the route module to wrap
   */
  private constructor(
    private readonly routeModule: RouteModule<RouteDefinition>
  ) {
    // TODO: (wyattjoh) possibly allow the module to define it's own matcher
    this.matcher = new RouteMatcher(routeModule.definition)
  }

  /**
   * This will wrap a module with the EdgeModuleWrapper and return a function
   * that can be used as a handler for the edge runtime.
   *
   * @param module the module to wrap
   * @param options any options that should be passed to the adapter and
   *                override the ones passed from the runtime
   * @returns a function that can be used as a handler for the edge runtime
   */
  public static wrap(
    routeModule: RouteModule<RouteDefinition>,
    options: WrapOptions = {}
  ) {
    // Create the module wrapper.
    const wrapper = new EdgeRouteModuleWrapper(routeModule)

    // Return the wrapping function.
    return (opts: AdapterOptions) => {
      return adapter({
        ...opts,
        ...options,
        IncrementalCache,
        // Bind the handler method to the wrapper so it still has context.
        handler: wrapper.handler.bind(wrapper),
      })
    }
  }

  private async handler(request: NextRequest): Promise<Response> {
    const url = new URL(request.url)

    // Get the pathname for the matcher. Pathnames should not have trailing
    // slashes for matching.
    const pathname = removeTrailingSlash(url.pathname)

    // Get the query string from the URL.
    const query = Object.fromEntries(url.searchParams.entries())

    // Get the match for this request.
    const match = this.matcher.match(pathname)
    if (!match) {
      throw new Error(
        `Invariant: no match found for request. Pathname '${pathname}' should have matched '${this.matcher.definition.pathname}'`
      )
    }

    // Create the context for the handler. This contains the params from the
    // match (if any).
    const context: RouteHandlerManagerContext = {
      params: match.params,
      export: false,
      staticGenerationContext: {
        supportsDynamicHTML: true,
        isRevalidate: false,
      },
      manifests: ManifestLoader.load(),

      // There are no headers set on the response above the handler in edge.
      headers: undefined,
      renderOpts: {
        query,

        // FIXME: (wyattjoh) implement
        isDataReq: undefined,
        resolvedAsPath: undefined,
        resolvedUrl: '',
        locale: undefined,
        defaultLocale: undefined,
        isLocaleDomain: undefined,

        // Not enabled/available in edge.
        req: undefined,
        res: undefined,
        statusCode: undefined,
        ampPath: undefined,
        customServer: undefined,
        distDir: undefined,
        err: undefined,
      },
      previewProps: undefined,
    }

    // Get the response from the handler.
    return await this.routeModule.handle(request, context)
  }
}
