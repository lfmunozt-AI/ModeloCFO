// Estado vacío: no hay hilo seleccionado.
export default function ChatIndexPage() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <p className="text-sm text-zinc-400">
        Selecciona un hilo en la barra lateral o crea uno nuevo para empezar.
      </p>
    </div>
  );
}
