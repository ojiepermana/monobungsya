import { Component, inject } from '@angular/core';
import { IconComponent } from '@ojiepermana/angular/component/icon';
import { LayoutService } from '@ojiepermana/angular/theme/layout/services';
import {
  PageComponent,
  PageContentComponent,
  PageHeaderComponent,
} from '@ojiepermana/angular/theme/page';

@Component({
  selector: 'app-groups-page',
  host: { class: 'block h-full min-h-0' },
  imports: [
    IconComponent,
    PageComponent,
    PageContentComponent,
    PageHeaderComponent,
  ],
  template: `
    <Page
      variant="stacked"
      scroll="content"
      [appearance]="layout.appearance()"
      class="h-full min-h-0"
    >
      <PageHeader class="flex min-h-(--layout-topbar-height) items-center gap-3 px-3">
        <div class="flex min-w-0 items-center gap-3">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Access</p>
          <h1 class="truncate text-lg font-semibold text-foreground">Group</h1>
        </div>
      </PageHeader>
      <PageContent class="grid min-h-0 content-start gap-6">
        <div class="border border-border bg-card px-3 py-6">
          <Icon name="group" [size]="28" class="text-muted-foreground" aria-hidden="true" />
          <p class="mt-4 text-sm text-muted-foreground">No groups found.</p>
        </div>
      </PageContent>
    </Page>
  `,
})
export class GroupsPage {
  protected readonly layout = inject(LayoutService);
}
