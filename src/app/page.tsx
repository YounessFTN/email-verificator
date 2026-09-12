import EmailVerifier from "@/components/EmailVerifier";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <EmailVerifier />
    </div>
  );
}
