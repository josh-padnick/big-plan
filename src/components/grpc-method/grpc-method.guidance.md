# Using GrpcMethod well

One gRPC method headed by its proto signature, with message fields, status codes, and grouped examples.

- Reach for it when a plan adds or changes a method; the proto signature is the contract under review.
- List the status codes the implementation will actually return, with the condition for each.
- One component per method, and keep field notes to what the type alone cannot say.
