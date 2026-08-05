import { DetailPage } from "./detail";

export const dynamic = "force-dynamic";

export default async function FilmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DetailPage id={id} expected="movie" />;
}
