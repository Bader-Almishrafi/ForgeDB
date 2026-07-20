import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="grid min-h-[65vh] place-items-center">
      <article class="card max-w-xl p-10 text-center">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-50 text-3xl text-indigo-600">◫</div>
        <h1 class="mt-5 text-2xl font-bold">{{ title }}</h1>
        <p class="mt-2 text-slate-500">This supporting page is outside the current ForgeDB MVP. The main documented workflow is fully available from data import through PostgreSQL deployment.</p>
        <a routerLink="/projects" class="btn-primary mt-6">Return to Projects</a>
      </article>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlaceholderComponent {
  private readonly route = inject(ActivatedRoute);
  readonly title = this.route.snapshot.data['title'] as string;
}
