defmodule FieldNotebook.Tides do
  @moduledoc """
  A self-contained tide model and a small supervisor-free process demo.

  Exercises modules, docs, guards, pattern matching, pipelines, structs,
  protocols, sigils, comprehensions and the pin operator.
  """

  @harmonic_period_hours 12.4206
  @ports ~w(eddystone fastnet bell_rock)a

  defstruct port: :eddystone, base: 3.4, amplitude: 2.7

  @type t :: %__MODULE__{port: atom(), base: float(), amplitude: float()}

  defmodule Reading do
    @enforce_keys [:hour, :height]
    defstruct [:hour, :height, phase: :rising]
  end

  defimpl String.Chars, for: Reading do
    def to_string(%Reading{hour: hour, height: height, phase: phase}) do
      "#{String.pad_leading(Integer.to_string(hour), 2, "0")}:00  #{height} m  (#{phase})"
    end
  end

  @doc "Predicted height, in metres, `hours` after high water."
  @spec predict(t(), number()) :: float()
  def predict(%__MODULE__{base: base, amplitude: amplitude}, hours) when is_number(hours) do
    angle = 2 * :math.pi() * hours / @harmonic_period_hours

    (base + amplitude * :math.cos(angle))
    |> Float.round(2)
  end

  @doc "A day of readings, phase-tagged."
  def forecast(%__MODULE__{} = model, hours \\ 12) do
    for hour <- 0..hours, reduce: {[], nil} do
      {acc, previous} ->
        height = predict(model, hour)
        phase = if previous == nil or height >= previous, do: :rising, else: :falling
        {[%Reading{hour: hour, height: height, phase: phase} | acc], height}
    end
    |> elem(0)
    |> Enum.reverse()
  end

  def known_port?(port) when port in @ports, do: true
  def known_port?(_), do: false

  def report(port \\ :fastnet) do
    model = %__MODULE__{port: port}

    model
    |> forecast()
    |> Enum.map(&to_string/1)
    |> Enum.each(&IO.puts/1)

    high = model |> forecast() |> Enum.max_by(& &1.height)
    IO.puts("\nHigh water at #{high.hour}:00 — #{high.height} m")
  end
end
