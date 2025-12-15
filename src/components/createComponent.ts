import { z } from "zod";
import { defineComponent } from "bitecs/legacy";

// Create a type that converts an object type to arrays
type ArraysFromShape<T> = {
  [K in keyof T]: T[K] extends z.ZodType ? T[K]["_output"][] : never;
};

export interface ComponentWithSchema<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  component: ArraysFromShape<T["shape"]>;
  type: z.infer<T>;
}

export function createComponent<T extends z.ZodObject<any>>(
  name: string,
  schema: T,
  componentArrays: Record<string, any[]>
): ComponentWithSchema<T> {
  // Create a tag component for bitecs queries
  const bitECSComponent = defineComponent({});

  // Create the component with arrays for each field
  const component = bitECSComponent as any;

  // Populate the arrays with type assertion for each field
  for (const [key, zodType] of Object.entries(schema.shape)) {
    const k = key as keyof T["shape"];
    if (!component[k]) {
        component[k] = (componentArrays[key] || []) as ArraysFromShape<T["shape"]>[typeof k];
    }
  }

  return {
    name,
    schema,
    component: component as ArraysFromShape<T["shape"]>,
    type: {} as z.infer<T>,
  };
}
