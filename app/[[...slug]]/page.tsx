import { Vendeora } from "../vendeora";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return (
    <Vendeora
      path={`/${slug?.join("/") ?? ""}`}
      captchaKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}
