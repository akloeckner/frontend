import "@lrnwebcomponents/simple-tooltip/simple-tooltip";
import {
  mdiCheck,
  mdiCheckCircleOutline,
  mdiDelete,
  mdiDotsVertical,
  mdiPencil,
  mdiPlus,
  mdiStar,
} from "@mdi/js";
import { LitElement, PropertyValues, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators";
import { ifDefined } from "lit/directives/if-defined";
import memoize from "memoize-one";
import { isComponentLoaded } from "../../../../common/config/is_component_loaded";
import { storage } from "../../../../common/decorators/storage";
import { navigate } from "../../../../common/navigate";
import { stringCompare } from "../../../../common/string/compare";
import { LocalizeFunc } from "../../../../common/translations/localize";
import {
  DataTableColumnContainer,
  RowClickedEvent,
  SortingChangedEvent,
} from "../../../../components/data-table/ha-data-table";
import "../../../../components/ha-clickable-list-item";
import "../../../../components/ha-fab";
import "../../../../components/ha-icon";
import "../../../../components/ha-icon-button";
import "../../../../components/ha-menu";
import type { HaMenu } from "../../../../components/ha-menu";
import "../../../../components/ha-menu-item";
import "../../../../components/ha-svg-icon";
import { LovelacePanelConfig } from "../../../../data/lovelace";
import {
  LovelaceRawConfig,
  isStrategyDashboard,
  saveConfig,
} from "../../../../data/lovelace/config/types";
import {
  LovelaceDashboard,
  LovelaceDashboardCreateParams,
  createDashboard,
  deleteDashboard,
  fetchDashboards,
  updateDashboard,
} from "../../../../data/lovelace/dashboard";
import { showConfirmationDialog } from "../../../../dialogs/generic/show-dialog-box";
import "../../../../layouts/hass-loading-screen";
import "../../../../layouts/hass-tabs-subpage-data-table";
import { HomeAssistant, Route } from "../../../../types";
import { getLovelaceStrategy } from "../../../lovelace/strategies/get-strategy";
import { showNewDashboardDialog } from "../../dashboard/show-dialog-new-dashboard";
import { lovelaceTabs } from "../ha-config-lovelace";
import { showDashboardConfigureStrategyDialog } from "./show-dialog-lovelace-dashboard-configure-strategy";
import { showDashboardDetailDialog } from "./show-dialog-lovelace-dashboard-detail";

type DataTableItem = Pick<
  LovelaceDashboard,
  "icon" | "title" | "show_in_sidebar" | "require_admin" | "mode" | "url_path"
> & {
  default: boolean;
  filename: string;
  iconColor?: string;
};

@customElement("ha-config-lovelace-dashboards")
export class HaConfigLovelaceDashboards extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean }) public isWide = false;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public route!: Route;

  @state() private _dashboards: LovelaceDashboard[] = [];

  @storage({
    storage: "sessionStorage",
    key: "lovelace-dashboards-table-search",
    state: true,
    subscribe: false,
  })
  private _filter: string = "";

  @storage({
    key: "lovelace-dashboards-table-sort",
    state: false,
    subscribe: false,
  })
  private _activeSorting?: SortingChangedEvent;

  @state() private _overflowDashboard?: LovelaceDashboard;

  @query("#overflow-menu") private _overflowMenu!: HaMenu;

  public willUpdate() {
    if (!this.hasUpdated) {
      this.hass.loadFragmentTranslation("lovelace");
    }
  }

  private _columns = memoize(
    (
      narrow: boolean,
      _language,
      dashboards,
      localize: LocalizeFunc
    ): DataTableColumnContainer => {
      const columns: DataTableColumnContainer<DataTableItem> = {
        icon: {
          title: "",
          label: localize(
            "ui.panel.config.lovelace.dashboards.picker.headers.icon"
          ),
          type: "icon",
          template: (dashboard) =>
            dashboard.icon
              ? html`
                  <ha-icon
                    slot="item-icon"
                    .icon=${dashboard.icon}
                    style=${ifDefined(
                      dashboard.iconColor
                        ? `color: ${dashboard.iconColor}`
                        : undefined
                    )}
                  ></ha-icon>
                `
              : nothing,
        },
        title: {
          title: localize(
            "ui.panel.config.lovelace.dashboards.picker.headers.title"
          ),
          main: true,
          sortable: true,
          filterable: true,
          grows: true,
          template: (dashboard) => {
            const titleTemplate = html`
              ${dashboard.title}
              ${dashboard.default
                ? html`
                    <ha-svg-icon
                      style="padding-left: 10px; padding-inline-start: 10px; direction: var(--direction);"
                      .path=${mdiCheckCircleOutline}
                    ></ha-svg-icon>
                    <simple-tooltip animation-delay="0">
                      ${this.hass.localize(
                        `ui.panel.config.lovelace.dashboards.default_dashboard`
                      )}
                    </simple-tooltip>
                  `
                : ""}
            `;
            return narrow
              ? html`
                  ${titleTemplate}
                  <div class="secondary">
                    ${this.hass.localize(
                      `ui.panel.config.lovelace.dashboards.conf_mode.${dashboard.mode}`
                    )}${dashboard.filename
                      ? html` – ${dashboard.filename} `
                      : ""}
                  </div>
                `
              : titleTemplate;
          },
        },
      };

      if (!narrow) {
        columns.mode = {
          title: localize(
            "ui.panel.config.lovelace.dashboards.picker.headers.conf_mode"
          ),
          sortable: true,
          filterable: true,
          width: "20%",
          template: (dashboard) => html`
            ${this.hass.localize(
              `ui.panel.config.lovelace.dashboards.conf_mode.${dashboard.mode}`
            ) || dashboard.mode}
          `,
        };
        if (dashboards.some((dashboard) => dashboard.filename)) {
          columns.filename = {
            title: localize(
              "ui.panel.config.lovelace.dashboards.picker.headers.filename"
            ),
            width: "15%",
            sortable: true,
            filterable: true,
          };
        }
        columns.require_admin = {
          title: localize(
            "ui.panel.config.lovelace.dashboards.picker.headers.require_admin"
          ),
          sortable: true,
          type: "icon",
          width: "100px",
          template: (dashboard) =>
            dashboard.require_admin
              ? html`<ha-svg-icon .path=${mdiCheck}></ha-svg-icon>`
              : html`—`,
        };
        columns.show_in_sidebar = {
          title: localize(
            "ui.panel.config.lovelace.dashboards.picker.headers.sidebar"
          ),
          type: "icon",
          width: "121px",
          template: (dashboard) =>
            dashboard.show_in_sidebar
              ? html`<ha-svg-icon .path=${mdiCheck}></ha-svg-icon>`
              : html`—`,
        };
      }

      columns.actions = {
        title: "",
        width: "64px",
        type: "icon-button",
        template: (dashboard) => html`
          <ha-icon-button
            .dashboard=${dashboard}
            .label=${this.hass.localize("ui.common.overflow_menu")}
            .path=${mdiDotsVertical}
            @click=${this._showOverflowMenu}
          ></ha-icon-button>
        `,
      };
      return columns;
    }
  );

  private _showOverflowMenu = (ev) => {
    if (
      this._overflowMenu.open &&
      ev.target === this._overflowMenu.anchorElement
    ) {
      this._overflowMenu.close();
      return;
    }
    this._overflowDashboard = ev.target.dashboard;
    this._overflowMenu.anchorElement = ev.target;
    this._overflowMenu.show();
  };

  private _getItems = memoize((dashboards: LovelaceDashboard[]) => {
    const defaultMode = (
      this.hass.panels?.lovelace?.config as LovelacePanelConfig
    ).mode;
    const defaultUrlPath = this.hass.defaultPanel;
    const isDefault = defaultUrlPath === "lovelace";
    const result: DataTableItem[] = [
      {
        icon: "hass:view-dashboard",
        title: this.hass.localize("panel.states"),
        default: isDefault,
        show_in_sidebar: isDefault,
        require_admin: false,
        url_path: "lovelace",
        mode: defaultMode,
        filename: defaultMode === "yaml" ? "ui-lovelace.yaml" : "",
        iconColor: "var(--primary-color)",
      },
    ];
    if (isComponentLoaded(this.hass, "energy")) {
      result.push({
        icon: "hass:lightning-bolt",
        title: this.hass.localize(`ui.panel.config.dashboard.energy.main`),
        show_in_sidebar: true,
        mode: "storage",
        url_path: "energy",
        filename: "",
        iconColor: "var(--label-badge-yellow)",
        default: false,
        require_admin: false,
      });
    }

    result.push(
      ...dashboards
        .sort((a, b) =>
          stringCompare(a.title, b.title, this.hass.locale.language)
        )
        .map((dashboard) => ({
          filename: "",
          ...dashboard,
          default: defaultUrlPath === dashboard.url_path,
        }))
    );
    return result;
  });

  protected render() {
    if (!this.hass || this._dashboards === undefined) {
      return html` <hass-loading-screen></hass-loading-screen> `;
    }

    return html`
      <hass-tabs-subpage-data-table
        .hass=${this.hass}
        .narrow=${this.narrow}
        back-path="/config"
        .route=${this.route}
        .tabs=${lovelaceTabs}
        .columns=${this._columns(
          this.narrow,
          this.hass.language,
          this._dashboards,
          this.hass.localize
        )}
        .data=${this._getItems(this._dashboards)}
        .initialSorting=${this._activeSorting}
        @sorting-changed=${this._handleSortingChanged}
        .filter=${this._filter}
        @search-changed=${this._handleSearchChange}
        @row-click=${this._navigate}
        id="url_path"
        hasFab
        clickable
      >
        ${this.hass.userData?.showAdvanced
          ? html`
              <ha-button-menu slot="toolbar-icon" activatable>
                <ha-icon-button
                  slot="trigger"
                  .label=${this.hass.localize("ui.common.menu")}
                  .path=${mdiDotsVertical}
                ></ha-icon-button>
                <ha-clickable-list-item href="/config/lovelace/resources">
                  ${this.hass.localize(
                    "ui.panel.config.lovelace.resources.caption"
                  )}
                </ha-clickable-list-item>
              </ha-button-menu>
            `
          : ""}
        <ha-fab
          slot="fab"
          .label=${this.hass.localize(
            "ui.panel.config.lovelace.dashboards.picker.add_dashboard"
          )}
          extended
          @click=${this._addDashboard}
        >
          <ha-svg-icon slot="icon" .path=${mdiPlus}></ha-svg-icon>
        </ha-fab>
      </hass-tabs-subpage-data-table>
      <ha-menu id="overflow-menu" positioning="fixed">
        <ha-menu-item @click=${this._editDashboard}>
          <ha-svg-icon .path=${mdiPencil} slot="start"></ha-svg-icon>
          <div slot="headline">Edit</div>
        </ha-menu-item>

        <ha-menu-item>
          <ha-svg-icon .path=${mdiStar} slot="start"></ha-svg-icon>
          <div slot="headline">Set to default</div>
        </ha-menu-item>
        <md-divider role="separator" tabindex="-1"></md-divider>
        <ha-menu-item class="warning">
          <ha-svg-icon .path=${mdiDelete} slot="start"></ha-svg-icon>
          <div slot="headline">Delete</div>
        </ha-menu-item>
      </ha-menu>
    `;
  }

  protected firstUpdated(changedProps: PropertyValues) {
    super.firstUpdated(changedProps);
    this._getDashboards();
  }

  private async _getDashboards() {
    this._dashboards = await fetchDashboards(this.hass);
  }

  private _navigate(ev: CustomEvent) {
    const urlPath = (ev.detail as RowClickedEvent).id;
    navigate(`/${urlPath}`);
  }

  private _editDashboard = (ev) => {
    ev.stopPropagation();
    const dashboard = ev.currentTarget.parentElement.anchorElement.automation;

    const urlPath = (ev.currentTarget as any).urlPath;

    if (urlPath === "energy") {
      navigate("/config/energy");
      return;
    }
    this._openDetailDialog(dashboard, urlPath);
  };

  private async _addDashboard() {
    showNewDashboardDialog(this, {
      selectConfig: async (config) => {
        if (config && isStrategyDashboard(config)) {
          const strategyType = config.strategy.type;
          const strategyClass = await getLovelaceStrategy(
            "dashboard",
            strategyType
          );

          if (strategyClass.configRequired) {
            showDashboardConfigureStrategyDialog(this, {
              config: config,
              saveConfig: async (updatedConfig) => {
                this._openDetailDialog(undefined, undefined, updatedConfig);
              },
            });
            return;
          }
        }

        this._openDetailDialog(undefined, undefined, config);
      },
    });
  }

  private async _openDetailDialog(
    dashboard?: LovelaceDashboard,
    urlPath?: string,
    defaultConfig?: LovelaceRawConfig
  ): Promise<void> {
    showDashboardDetailDialog(this, {
      dashboard,
      urlPath,
      createDashboard: async (values: LovelaceDashboardCreateParams) => {
        const created = await createDashboard(this.hass!, values);
        this._dashboards = this._dashboards!.concat(created).sort(
          (res1, res2) =>
            stringCompare(
              res1.url_path,
              res2.url_path,
              this.hass.locale.language
            )
        );
        if (defaultConfig) {
          await saveConfig(this.hass!, created.url_path, defaultConfig);
        }
      },
      updateDashboard: async (values) => {
        const updated = await updateDashboard(
          this.hass!,
          dashboard!.id,
          values
        );
        this._dashboards = this._dashboards!.map((res) =>
          res === dashboard ? updated : res
        );
      },
      removeDashboard: async () => {
        const confirm = await showConfirmationDialog(this, {
          title: this.hass!.localize(
            "ui.panel.config.lovelace.dashboards.confirm_delete_title",
            { dashboard_title: dashboard!.title }
          ),
          text: this.hass!.localize(
            "ui.panel.config.lovelace.dashboards.confirm_delete_text"
          ),
          confirmText: this.hass!.localize("ui.common.delete"),
          destructive: true,
        });
        if (!confirm) {
          return false;
        }
        try {
          await deleteDashboard(this.hass!, dashboard!.id);
          this._dashboards = this._dashboards!.filter(
            (res) => res !== dashboard
          );
          return true;
        } catch (err: any) {
          return false;
        }
      },
    });
  }

  private _handleSortingChanged(ev: CustomEvent) {
    this._activeSorting = ev.detail;
  }

  private _handleSearchChange(ev: CustomEvent) {
    this._filter = ev.detail.value;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-lovelace-dashboards": HaConfigLovelaceDashboards;
  }
}
