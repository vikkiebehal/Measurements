import ResultClient from "./result-client";

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResultClient id={id} />;
}
